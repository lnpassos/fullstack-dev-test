import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:gift_message_suggester/core/network/failure.dart';
import 'package:gift_message_suggester/features/suggestions/data/suggestions_api.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestion.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// Parsing and error mapping.
///
/// This is the layer that has to agree with `backend/openapi.yaml`, so the
/// fixtures below are the spec's own example payloads. The backend has a
/// contract test pinning the same shapes from its side; between them, a drift
/// fails on one side or the other rather than only in production.
void main() {
  const query = SuggestionQuery(occasion: 'Birthday', relationship: 'Friend');

  SuggestionsApi apiReturning(
    String body, {
    int status = 200,
    void Function(http.Request request)? onRequest,
  }) {
    return SuggestionsApi(
      baseUrl: 'http://test.local',
      client: MockClient((request) async {
        onRequest?.call(request);
        return http.Response(
          body,
          status,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
  }

  String successBody({bool degraded = false}) => jsonEncode({
    'suggestions': [
      {'id': 's_1', 'text': 'Wishing you the happiest of birthdays.'},
      {'id': 's_2', 'text': 'Hope your day is as good as you are.'},
    ],
    'meta': {
      'source': degraded ? 'fallback' : 'llm',
      'degraded': degraded,
      'model': degraded ? null : 'gemini-flash-latest',
      'requestId': '4f1c8a2e',
      'latencyMs': 842,
    },
  });

  group('fetchSuggestions', () {
    test('parses a normal response', () async {
      final result = await apiReturning(successBody()).fetchSuggestions(query);

      expect(result.suggestions, hasLength(2));
      expect(result.suggestions.first.id, 's_1');
      expect(result.source, SuggestionSource.llm);
      expect(result.degraded, isFalse);
    });

    test('parses a degraded response as a success', () async {
      final result = await apiReturning(successBody(degraded: true))
          .fetchSuggestions(query);

      expect(result.degraded, isTrue);
      expect(result.source, SuggestionSource.fallback);
      expect(result.suggestions, isNotEmpty);
    });

    test('posts the documented request body', () async {
      http.Request? captured;
      await apiReturning(
        successBody(),
        onRequest: (request) => captured = request,
      ).fetchSuggestions(
        const SuggestionQuery(
          occasion: 'Wedding',
          relationship: 'Colleague',
          tone: 'formal',
          count: 2,
        ),
      );

      expect(captured!.url.path, '/api/v1/suggestions');
      expect(captured!.method, 'POST');
      expect(jsonDecode(captured!.body), {
        'occasion': 'Wedding',
        'relationship': 'Colleague',
        'tone': 'formal',
        'count': 2,
      });
    });

    test('sends a correlation id so the trace starts in the app', () async {
      http.Request? captured;
      await apiReturning(
        successBody(),
        onRequest: (request) => captured = request,
      ).fetchSuggestions(query);

      final sent = captured!.headers['X-Request-Id'];
      // A request that never reaches the server still has an id the user can
      // quote, which a server-generated id could not provide.
      expect(sent, isNotNull);
      expect(sent, matches(RegExp(r'^[0-9a-f-]{36}$')));
    });

    test('tolerates a source this build does not know', () async {
      // A server that adds a source must not break an older app. `degraded` is
      // what the UI branches on, and it survives.
      final body = jsonEncode({
        'suggestions': [
          {'id': 's_1', 'text': 'Happy birthday.'},
        ],
        'meta': {'source': 'something_new', 'degraded': false},
      });

      final result = await apiReturning(body).fetchSuggestions(query);
      expect(result.degraded, isFalse);
      expect(result.suggestions, hasLength(1));
    });
  });

  group('error mapping', () {
    Future<SuggestionFailure> failureFrom(String body, int status) async {
      try {
        await apiReturning(body, status: status).fetchSuggestions(query);
        fail('expected a SuggestionFailure');
      } on SuggestionFailure catch (failure) {
        return failure;
      }
    }

    test('maps VALIDATION_ERROR with its field detail', () async {
      final body = jsonEncode({
        'error': {
          'code': 'VALIDATION_ERROR',
          'message': 'The request could not be processed.',
          'requestId': 'r1',
          'details': [
            {
              'field': 'occasion',
              'rule': 'too_short',
              'message': 'occasion must be at least 2 characters.',
            },
          ],
        },
      });

      final failure = await failureFrom(body, 400);
      expect(failure, isA<ValidationFailure>());

      final violations = (failure as ValidationFailure).violations;
      expect(violations, hasLength(1));
      expect(violations.single.field, 'occasion');
      // The machine-readable half. The server's English `message` is
      // deliberately discarded: a localised client cannot render it.
      expect(violations.single.rule, ValidationRule.tooShort);
      // Retrying an identical rejected request is pointless.
      expect(failure.isRetryable, isFalse);
    });

    test('maps RATE_LIMITED', () async {
      final body = jsonEncode({
        'error': {
          'code': 'RATE_LIMITED',
          'message': 'Too many requests.',
          'requestId': 'r2',
        },
      });

      expect(await failureFrom(body, 429), isA<RateLimitedFailure>());
    });

    test('maps a 500 and keeps the request id for the user to quote', () async {
      final body = jsonEncode({
        'error': {
          'code': 'INTERNAL_ERROR',
          'message': 'An unexpected error occurred.',
          'requestId': 'abc-123',
        },
      });

      final failure = await failureFrom(body, 500);
      expect(failure, isA<ServerFailure>());
      // Carried as data; the presentation layer decides how to word it.
      expect((failure as ServerFailure).requestId, 'abc-123');
    });

    test(
      'falls back to the status code when the body is not our envelope',
      () async {
        // A proxy or load balancer returning its own HTML error page.
        final failure = await failureFrom('<html>502 Bad Gateway</html>', 502);
        expect(failure, isA<ServerFailure>());
      },
    );

    test('maps an unparseable 200 to an unexpected failure', () async {
      expect(
        await failureFrom('not json at all', 200),
        isA<UnexpectedFailure>(),
      );
    });

    test(
      'rejects a 200 with no suggestions rather than rendering nothing',
      () async {
        final body = jsonEncode({
          'suggestions': <Object>[],
          'meta': {'source': 'llm', 'degraded': false},
        });

        expect(await failureFrom(body, 200), isA<UnexpectedFailure>());
      },
    );

    test('maps a transport error to a network failure', () async {
      final api = SuggestionsApi(
        baseUrl: 'http://test.local',
        client: MockClient(
          (_) async => throw http.ClientException('connection refused'),
        ),
      );

      await expectLater(
        api.fetchSuggestions(query),
        throwsA(isA<NetworkFailure>()),
      );
    });
  });

  group('fetchOptions', () {
    test('parses the server vocabulary', () async {
      final body = jsonEncode({
        'occasions': ['Birthday'],
        'relationships': ['Friend'],
        'tones': ['warm', 'funny'],
      });

      final options = await apiReturning(body).fetchOptions();
      expect(options.occasions, ['Birthday']);
      expect(options.tones, ['warm', 'funny']);
    });

    test('degrades to built-in defaults instead of failing', () async {
      // The pickers are a convenience. Failing here must not stop someone
      // typing their own occasion.
      final api = SuggestionsApi(
        baseUrl: 'http://test.local',
        client: MockClient((_) async => throw http.ClientException('offline')),
      );

      final options = await api.fetchOptions();
      expect(options.occasions, SuggestionOptions.defaults.occasions);
    });

    test('degrades on a malformed body too', () async {
      final options = await apiReturning('{"occasions": "not a list"}')
          .fetchOptions();
      expect(options.occasions, SuggestionOptions.defaults.occasions);
    });
  });
}
