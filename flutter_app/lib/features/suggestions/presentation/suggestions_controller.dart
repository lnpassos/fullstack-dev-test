import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/failure.dart';
import '../domain/suggestion.dart';
import 'providers.dart';
import 'suggestions_state.dart';

/// Owns the screen's state transitions and nothing else.
///
/// No widget calls the repository and no widget builds a [SuggestionQuery]; that
/// keeps the state machine testable without pumping a widget tree, and keeps the
/// widgets to rendering whatever state they are handed.
class SuggestionsController extends Notifier<SuggestionsState> {
  @override
  SuggestionsState build() => const SuggestionsIdle();

  /// The last query, so [retry] does not need the form to still hold it.
  SuggestionQuery? _lastQuery;

  /// Guards against a slow first response overwriting a faster second one.
  ///
  /// Someone who taps twice in a row would otherwise see the later result
  /// replaced by the earlier one when it finally lands.
  int _requestId = 0;

  Future<void> request(SuggestionQuery query) async {
    _lastQuery = query;
    final requestId = ++_requestId;

    // Keep any existing suggestions visible while the next batch loads.
    final previous = switch (state) {
      SuggestionsReady(:final result) => result,
      SuggestionsLoading(:final previous?) => previous,
      _ => null,
    };
    state = SuggestionsLoading(previous: previous);

    try {
      final result = await ref
          .read(suggestionsRepositoryProvider)
          .fetchSuggestions(query);
      if (requestId != _requestId) return;
      state = SuggestionsReady(result);
    } on SuggestionFailure catch (failure) {
      if (requestId != _requestId) return;
      state = SuggestionsFailed(failure);
    } on Object {
      if (requestId != _requestId) return;
      // The repository is expected to translate everything into a
      // SuggestionFailure. Anything else is a bug in that translation, and the
      // user still deserves a screen rather than a red error box.
      state = const SuggestionsFailed(UnexpectedFailure());
    }
  }

  /// Re-runs the last query. No-op before the first request.
  Future<void> retry() async {
    final query = _lastQuery;
    if (query == null) return;
    await request(query);
  }
}
