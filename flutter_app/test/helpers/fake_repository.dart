import 'package:gift_message_suggester/core/network/failure.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestion.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestions_repository.dart';

/// Scriptable repository — the app's counterpart to the backend's
/// `FakeLlmProvider`.
///
/// Substituting at this boundary is what makes every screen state reachable in a
/// widget test: loading, success, degraded, and each failure kind, with no
/// server and no HTTP stubbing.
class FakeRepository implements SuggestionsRepository {
  FakeRepository({
    SuggestionResult? result,
    this.failure,
    this.options = SuggestionOptions.defaults,
    this.delay = Duration.zero,
  }) : _result = result ?? defaultResult();

  final SuggestionResult _result;

  /// When set, every call throws this instead of returning a result.
  final SuggestionFailure? failure;
  final SuggestionOptions options;

  /// Lets a test observe the loading state before the answer lands.
  final Duration delay;

  /// Queries received, in order. Asserted on to prove the screen does not call
  /// the API for input it should have rejected itself.
  final List<SuggestionQuery> received = [];

  static SuggestionResult defaultResult({bool degraded = false}) =>
      SuggestionResult(
        suggestions: const [
          Suggestion(id: 's_1', text: 'Wishing you the happiest of birthdays.'),
          Suggestion(id: 's_2', text: 'Hope your day is as good as you are.'),
          Suggestion(id: 's_3', text: 'Here is to a year worth celebrating.'),
        ],
        source: degraded ? SuggestionSource.fallback : SuggestionSource.llm,
        degraded: degraded,
      );

  @override
  Future<SuggestionResult> fetchSuggestions(SuggestionQuery query) async {
    received.add(query);
    if (delay > Duration.zero) await Future<void>.delayed(delay);
    final scripted = failure;
    if (scripted != null) throw scripted;
    return _result;
  }

  @override
  Future<SuggestionOptions> fetchOptions() async => options;
}

/// Fails the first call, then succeeds — for exercising the retry button.
class FlakyRepository implements SuggestionsRepository {
  int callCount = 0;

  @override
  Future<SuggestionResult> fetchSuggestions(SuggestionQuery query) async {
    callCount += 1;
    if (callCount == 1) throw const NetworkFailure();
    return FakeRepository.defaultResult();
  }

  @override
  Future<SuggestionOptions> fetchOptions() async => SuggestionOptions.defaults;
}
