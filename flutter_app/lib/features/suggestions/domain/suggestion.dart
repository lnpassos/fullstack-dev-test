import 'package:flutter/foundation.dart';

/// Domain model, mirroring `backend/openapi.yaml`.
///
/// The spec is the source of truth for these names; when the two disagree, this
/// file is the one that is wrong. See `CLAUDE.md`.

/// Where the messages came from.
enum SuggestionSource {
  /// Generated for this request.
  llm,

  /// A previous generation for an equivalent query.
  cache,

  /// Curated messages: the model could not be reached.
  fallback;

  /// Tolerant of a value this build has never heard of.
  ///
  /// A server that learns a new source must not break an app that has not been
  /// updated yet — and the app does not branch on this anyway. It branches on
  /// `degraded`, which is a boolean and cannot acquire new members.
  static SuggestionSource parse(String? raw) => switch (raw) {
    'llm' => SuggestionSource.llm,
    'cache' => SuggestionSource.cache,
    'fallback' => SuggestionSource.fallback,
    _ => SuggestionSource.llm,
  };
}

@immutable
class Suggestion {
  const Suggestion({required this.id, required this.text});

  final String id;
  final String text;

  @override
  bool operator ==(Object other) =>
      other is Suggestion && other.id == id && other.text == text;

  @override
  int get hashCode => Object.hash(id, text);
}

@immutable
class SuggestionResult {
  const SuggestionResult({
    required this.suggestions,
    required this.source,
    required this.degraded,
  });

  final List<Suggestion> suggestions;
  final SuggestionSource source;

  /// True when the LLM could not serve this request.
  ///
  /// The single flag the UI branches on. Kept separate from [source] because it
  /// is a stable boolean, while the set of sources may grow.
  final bool degraded;

  // `meta.model` and `meta.requestId` are deliberately not modelled here. They
  // are server diagnostics: the app has no use for a model name, and the
  // correlation id it would show a user comes from `ServerFailure`, not from a
  // successful response. A client should model what it uses.
}

/// What the user asked for.
@immutable
class SuggestionQuery {
  const SuggestionQuery({
    required this.occasion,
    required this.relationship,
    this.tone = 'warm',
    this.count = 3,
  });

  final String occasion;
  final String relationship;
  final String tone;
  final int count;
}

/// Vocabulary offered by the pickers.
///
/// Fetched from the server so a new occasion does not need a new app build, but
/// the app carries defaults: the picker is a convenience, and failing to load it
/// must not stop someone typing their own occasion.
@immutable
class SuggestionOptions {
  const SuggestionOptions({
    required this.occasions,
    required this.relationships,
    required this.tones,
  });

  static const SuggestionOptions defaults = SuggestionOptions(
    occasions: [
      'Birthday',
      'Wedding',
      'Anniversary',
      'Thank you',
      'Congratulations',
      'Graduation',
      'Holidays',
      'New baby',
      'Get well',
      'Retirement',
      'Housewarming',
      'Farewell',
    ],
    relationships: [
      'Friend',
      'Colleague',
      'Manager',
      'Client',
      'Partner',
      'Mother',
      'Father',
      'Sister',
      'Brother',
      'Daughter',
      'Son',
      'Grandparent',
      'Teacher',
    ],
    tones: ['warm', 'funny', 'formal', 'heartfelt'],
  );

  final List<String> occasions;
  final List<String> relationships;
  final List<String> tones;
}
