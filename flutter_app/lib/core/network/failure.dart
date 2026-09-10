import 'package:flutter/foundation.dart';

/// Everything that can go wrong on the way to a suggestion.
///
/// A sealed hierarchy rather than an error string, for the same reason the
/// backend separates `AppError` from `LlmError`: the UI has to *decide* things —
/// whether to offer a retry, whether to point at a field — and deciding from a
/// formatted message means parsing prose.
///
/// Note what is *not* here: a degraded response is not a failure. When the LLM is
/// unavailable the server still returns usable messages with
/// `meta.degraded: true`, and the app shows them with a notice. Modelling that
/// as an error would throw away a perfectly good answer.
@immutable
sealed class SuggestionFailure {
  const SuggestionFailure();

  /// Copy shown to the user. Written here so the widgets stay free of wording.
  String get message;

  /// Whether offering a "try again" affordance makes sense.
  ///
  /// False for rejected input: retrying the identical request produces the
  /// identical rejection, and a button that visibly does nothing is worse than
  /// no button.
  bool get isRetryable => true;
}

/// The server could not be reached at all.
final class NetworkFailure extends SuggestionFailure {
  const NetworkFailure();

  @override
  String get message =>
      'Could not reach the server. Check that the backend is running and try again.';
}

/// The request outlived the client deadline.
final class TimeoutFailure extends SuggestionFailure {
  const TimeoutFailure();

  @override
  String get message => 'The request took too long. Please try again.';
}

/// Too many requests (HTTP 429).
final class RateLimitedFailure extends SuggestionFailure {
  const RateLimitedFailure();

  @override
  String get message =>
      'Too many requests. Please wait a moment before trying again.';
}

/// The server failed in a way it did not anticipate (HTTP 5xx).
final class ServerFailure extends SuggestionFailure {
  const ServerFailure({this.requestId});

  /// Echoed back so a user reporting the problem can quote it. It is the only
  /// internal detail the server exposes, and it is what makes a report useful.
  final String? requestId;

  @override
  String get message => requestId == null
      ? 'Something went wrong on the server. Please try again.'
      : 'Something went wrong on the server. Please try again.\nReference: $requestId';
}

/// A response we could not make sense of — wrong shape, unparseable body.
final class UnexpectedFailure extends SuggestionFailure {
  const UnexpectedFailure();

  @override
  String get message => 'Something unexpected happened. Please try again.';
}

/// The server rejected the input (HTTP 400).
final class ValidationFailure extends SuggestionFailure {
  const ValidationFailure({this.violations = const []});

  final List<FieldViolation> violations;

  @override
  String get message => violations.isEmpty
      ? 'Please check the occasion and relationship and try again.'
      : violations.map((violation) => violation.message).join('\n');

  @override
  bool get isRetryable => false;
}

/// Why the server rejected one field.
///
/// Mirrors `ValidationDetail` in `backend/openapi.yaml`. The server also sends an
/// English `message`, but it is documented as developer-facing; the client words
/// its own from [rule], which is the half that is stable and machine-readable.
@immutable
class FieldViolation {
  const FieldViolation({required this.field, required this.rule});

  final String field;
  final ValidationRule rule;

  String get message {
    final label = _label(field);
    return switch (rule) {
      ValidationRule.required => 'Please enter $label.',
      ValidationRule.tooShort => '$label must be at least 2 characters.',
      ValidationRule.tooLong => '$label is too long.',
      ValidationRule.invalidFormat =>
        '$label contains characters we cannot use.',
      ValidationRule.invalidValue => '$label is not valid.',
      ValidationRule.unknownField =>
        'The request contained something unexpected.',
    };
  }

  /// Field names arrive as the API's identifiers; the user should see the word
  /// the form uses. An unmapped field falls back to the raw name.
  static String _label(String field) => switch (field) {
    'occasion' => 'Occasion',
    'relationship' => 'Relationship',
    'tone' => 'Tone',
    _ => field,
  };

  @override
  bool operator ==(Object other) =>
      other is FieldViolation && other.field == field && other.rule == rule;

  @override
  int get hashCode => Object.hash(field, rule);
}

/// The rule vocabulary documented in the OpenAPI spec.
enum ValidationRule {
  required,
  tooShort,
  tooLong,
  invalidFormat,
  invalidValue,
  unknownField;

  /// Tolerant of a rule this build has never heard of.
  ///
  /// A server that adds a rule must not break an older app: an unknown value
  /// degrades to the generic wording rather than throwing.
  static ValidationRule parse(String? raw) => switch (raw) {
    'required' => ValidationRule.required,
    'too_short' => ValidationRule.tooShort,
    'too_long' => ValidationRule.tooLong,
    'invalid_format' => ValidationRule.invalidFormat,
    'unknown_field' => ValidationRule.unknownField,
    _ => ValidationRule.invalidValue,
  };
}
