import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gift_message_suggester/core/network/failure.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestion.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestions_repository.dart';
import 'package:gift_message_suggester/features/suggestions/presentation/providers.dart';
import 'package:gift_message_suggester/features/suggestions/presentation/suggestions_state.dart';

import '../../../helpers/fake_repository.dart';

/// The state machine, without a widget tree.
void main() {
  const query = SuggestionQuery(occasion: 'Birthday', relationship: 'Friend');

  ProviderContainer containerWith(SuggestionsRepository repository) {
    final container = ProviderContainer(
      overrides: [suggestionsRepositoryProvider.overrideWithValue(repository)],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('starts idle', () {
    final container = containerWith(FakeRepository());
    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsIdle>(),
    );
  });

  test('goes to loading and then ready', () async {
    final container = containerWith(
      FakeRepository(delay: const Duration(milliseconds: 20)),
    );
    final controller = container.read(suggestionsControllerProvider.notifier);

    final pending = controller.request(query);
    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsLoading>(),
    );

    await pending;
    final state = container.read(suggestionsControllerProvider);
    expect(state, isA<SuggestionsReady>());
    expect((state as SuggestionsReady).result.suggestions, hasLength(3));
  });

  test('treats a degraded response as success, not failure', () async {
    final container = containerWith(
      FakeRepository(result: FakeRepository.defaultResult(degraded: true)),
    );

    await container.read(suggestionsControllerProvider.notifier).request(query);

    final state = container.read(suggestionsControllerProvider);
    // The whole point of the backend answering 200 on the fallback path: the
    // user gets messages, and the UI is told they are the generic ones.
    expect(state, isA<SuggestionsReady>());
    expect((state as SuggestionsReady).result.degraded, isTrue);
    expect(state.result.source, SuggestionSource.fallback);
  });

  test('surfaces a failure as SuggestionsFailed', () async {
    final container = containerWith(
      FakeRepository(failure: const NetworkFailure()),
    );

    await container.read(suggestionsControllerProvider.notifier).request(query);

    final state = container.read(suggestionsControllerProvider);
    expect(state, isA<SuggestionsFailed>());
    expect((state as SuggestionsFailed).failure, isA<NetworkFailure>());
  });

  test('keeps the previous results visible while reloading', () async {
    final container = containerWith(
      FakeRepository(delay: const Duration(milliseconds: 20)),
    );
    final controller = container.read(suggestionsControllerProvider.notifier);

    await controller.request(query);
    final pending = controller.request(query);

    final loading = container.read(suggestionsControllerProvider);
    expect(loading, isA<SuggestionsLoading>());
    // Content vanishing and returning is the jarring part of a reload.
    expect((loading as SuggestionsLoading).previous, isNotNull);

    await pending;
  });

  test('retry re-runs the last query', () async {
    final repository = FlakyRepository();
    final container = containerWith(repository);
    final controller = container.read(suggestionsControllerProvider.notifier);

    await controller.request(query);
    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsFailed>(),
    );

    await controller.retry();

    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsReady>(),
    );
    expect(repository.callCount, 2);
  });

  test('retry before any request does nothing', () async {
    final repository = FakeRepository();
    final container = containerWith(repository);

    await container.read(suggestionsControllerProvider.notifier).retry();

    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsIdle>(),
    );
    expect(repository.received, isEmpty);
  });

  test('a superseded response does not overwrite a newer one', () async {
    // First call is slow and fails, second is fast and succeeds. Without the
    // request-id guard the late failure would clobber the good result.
    var call = 0;
    final repository = _OrderedRepository(
      onFetch: (query) async {
        call += 1;
        if (call == 1) {
          await Future<void>.delayed(const Duration(milliseconds: 60));
          throw const NetworkFailure();
        }
        return FakeRepository.defaultResult();
      },
    );

    final container = containerWith(repository);
    final controller = container.read(suggestionsControllerProvider.notifier);

    final slow = controller.request(query);
    final fast = controller.request(query);

    await fast;
    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsReady>(),
    );

    await slow;
    expect(
      container.read(suggestionsControllerProvider),
      isA<SuggestionsReady>(),
      reason: 'the stale failure must be discarded',
    );
  });
}

class _OrderedRepository implements SuggestionsRepository {
  _OrderedRepository({required this.onFetch});

  final Future<SuggestionResult> Function(SuggestionQuery query) onFetch;

  @override
  Future<SuggestionResult> fetchSuggestions(SuggestionQuery query) =>
      onFetch(query);

  @override
  Future<SuggestionOptions> fetchOptions() async => SuggestionOptions.defaults;
}
