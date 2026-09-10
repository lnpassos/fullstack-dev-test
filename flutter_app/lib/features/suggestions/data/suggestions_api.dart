import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../core/config/app_config.dart';
import '../../../core/network/failure.dart';
import '../../../core/network/request_id.dart';
import '../domain/suggestion.dart';
import '../domain/suggestions_repository.dart';

/// HTTP implementation of [SuggestionsRepository].
///
/// The only file in the app that knows the API exists. Its job is to turn every
/// possible transport outcome into either a domain object or a
/// [SuggestionFailure] — the mirror image of what the Gemini adapter does on the
/// server, and for the same reason: the layers above should reason about
/// failures in their own vocabulary, not in HTTP status codes.
class SuggestionsApi implements SuggestionsRepository {
  SuggestionsApi({http.Client? client, String? baseUrl})
    : _client = client ?? http.Client(),
      _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  static const String _apiPrefix = '/api/v1';

  @override
  Future<SuggestionResult> fetchSuggestions(SuggestionQuery query) async {
    final response = await _post('$_apiPrefix/suggestions', {
      'occasion': query.occasion,
      'relationship': query.relationship,
      'tone': query.tone,
      'count': query.count,
    });

    if (response.statusCode == 200) {
      return _parseResult(response.body);
    }

    throw _failureFor(response);
  }

  @override
  Future<SuggestionOptions> fetchOptions() async {
    try {
      final response = await _client
          .get(Uri.parse('$_baseUrl$_apiPrefix/options'))
          .timeout(AppConfig.requestTimeout);

      if (response.statusCode != 200) {
        return SuggestionOptions.defaults;
      }

      final body = jsonDecode(response.body) as Map<String, dynamic>;
      return SuggestionOptions(
        occasions:
            _stringList(body['occasions']) ??
            SuggestionOptions.defaults.occasions,
        relationships:
            _stringList(body['relationships']) ??
            SuggestionOptions.defaults.relationships,
        tones: _stringList(body['tones']) ?? SuggestionOptions.defaults.tones,
      );
    } on Object {
      // Swallowed on purpose: the pickers are a convenience. Anything that goes
      // wrong here degrades to the built-in list, and the user can still type.
      return SuggestionOptions.defaults;
    }
  }

  Future<http.Response> _post(String path, Map<String, Object?> body) async {
    try {
      return await _client
          .post(
            Uri.parse('$_baseUrl$path'),
            headers: {
              'Content-Type': 'application/json',
              // The server honours an inbound id, so the trace begins in the app
              // and survives a request that never reaches the server.
              'X-Request-Id': newRequestId(),
            },
            body: jsonEncode(body),
          )
          .timeout(AppConfig.requestTimeout);
    } on TimeoutException {
      throw const TimeoutFailure();
    } on Object {
      // `http` throws ClientException on web and SocketException on native for
      // the same underlying condition, so both collapse to one failure rather
      // than the app carrying platform-specific branches.
      throw const NetworkFailure();
    }
  }

  SuggestionResult _parseResult(String body) {
    try {
      final json = jsonDecode(body) as Map<String, dynamic>;
      final meta = json['meta'] as Map<String, dynamic>? ?? const {};

      final suggestions = (json['suggestions'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .map(
            (item) => Suggestion(
              id: item['id'] as String,
              text: item['text'] as String,
            ),
          )
          .toList(growable: false);

      // A 200 with no suggestions would be a server bug, but the app must not
      // render an empty success screen if it ever happens.
      if (suggestions.isEmpty) throw const UnexpectedFailure();

      return SuggestionResult(
        suggestions: suggestions,
        source: SuggestionSource.parse(meta['source'] as String?),
        degraded: meta['degraded'] as bool? ?? false,
      );
    } on SuggestionFailure {
      rethrow;
    } on Object {
      // Malformed or unexpected shape. Nothing actionable to show the user, so
      // it becomes the generic failure rather than a parser error on screen.
      throw const UnexpectedFailure();
    }
  }

  /// Maps an error response onto the failure hierarchy.
  ///
  /// Branches on `error.code` where possible — the server documents it as stable
  /// — and on the status code otherwise, so an unrecognised code still lands
  /// somewhere sensible.
  SuggestionFailure _failureFor(http.Response response) {
    Map<String, dynamic> error = const {};
    try {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      error = json['error'] as Map<String, dynamic>? ?? const {};
    } on Object {
      // An error response that is not our envelope (a proxy's HTML page, say).
      // The status code is still informative.
    }

    final code = error['code'] as String?;
    final requestId = error['requestId'] as String?;

    return switch (code) {
      'VALIDATION_ERROR' => ValidationFailure(
        violations: _violations(error['details']),
      ),
      'RATE_LIMITED' => const RateLimitedFailure(),
      _ => switch (response.statusCode) {
        400 ||
        413 => ValidationFailure(violations: _violations(error['details'])),
        429 => const RateLimitedFailure(),
        >= 500 => ServerFailure(requestId: requestId),
        _ => const UnexpectedFailure(),
      },
    };
  }

  /// Keeps `field` and `rule`, discards the server's `message`.
  ///
  /// The server's message is documented as developer-facing copy that may
  /// change; `rule` is the stable half, and the client words its own from it.
  List<FieldViolation> _violations(Object? details) {
    if (details is! List) return const [];

    return [
      for (final entry in details.whereType<Map<String, dynamic>>())
        if (entry['field'] is String)
          FieldViolation(
            field: entry['field'] as String,
            rule: ValidationRule.parse(entry['rule'] as String?),
          ),
    ];
  }

  List<String>? _stringList(Object? value) {
    if (value is! List) return null;
    final items = value.whereType<String>().toList(growable: false);
    return items.isEmpty ? null : items;
  }
}
