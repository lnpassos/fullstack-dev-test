import 'package:flutter/foundation.dart';

import '../../../core/network/failure.dart';
import '../domain/suggestion.dart';

/// The screen's state, as a closed set.
///
/// Sealed so the widget tree can `switch` over it exhaustively: adding a state
/// later becomes a compile error at every place that renders one, instead of a
/// silently missing branch that shows a blank screen.
///
/// There is deliberately no `degraded` state. A degraded response is
/// [SuggestionsReady] whose result carries `degraded: true` — it is a success
/// with a caveat, and the UI renders it as suggestions plus a notice.
@immutable
sealed class SuggestionsState {
  const SuggestionsState();
}

/// Nothing requested yet.
final class SuggestionsIdle extends SuggestionsState {
  const SuggestionsIdle();
}

/// A request is in flight.
final class SuggestionsLoading extends SuggestionsState {
  const SuggestionsLoading({this.previous});

  /// The last successful result, if any.
  ///
  /// Kept so a refresh can leave the existing suggestions on screen instead of
  /// replacing them with a spinner — content disappearing and coming back is
  /// the jarring part of a reload, not the wait.
  final SuggestionResult? previous;
}

/// Suggestions are available. Check `result.degraded` before celebrating.
final class SuggestionsReady extends SuggestionsState {
  const SuggestionsReady(this.result);

  final SuggestionResult result;
}

/// The request failed and there is nothing to show.
final class SuggestionsFailed extends SuggestionsState {
  const SuggestionsFailed(this.failure);

  final SuggestionFailure failure;
}
