import 'suggestion.dart';

/// The boundary the presentation layer depends on.
///
/// An interface rather than the concrete HTTP client so widget tests can drive
/// every state — loading, degraded, each failure kind — without a server and
/// without stubbing `http` internals. The tests that matter here are about what
/// the user sees, not about JSON parsing.
///
/// Implementations translate transport problems into [SuggestionFailure] and
/// throw that; nothing above this line ever sees an `http` type or a status code.
abstract interface class SuggestionsRepository {
  /// Throws [SuggestionFailure] on any failure.
  ///
  /// A degraded response is *not* a failure: it arrives as a normal
  /// [SuggestionResult] with `degraded: true`.
  Future<SuggestionResult> fetchSuggestions(SuggestionQuery query);

  /// Vocabulary for the pickers.
  ///
  /// Implementations fall back to [SuggestionOptions.defaults] rather than
  /// throwing: a picker that fails to load is a cosmetic problem, and blocking
  /// the screen on it would turn it into a functional one.
  Future<SuggestionOptions> fetchOptions();
}
