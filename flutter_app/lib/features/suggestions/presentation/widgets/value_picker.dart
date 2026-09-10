import 'package:flutter/material.dart';

import '../../../../core/network/failure.dart';

/// A text field that can also be filled from a list of common values.
///
/// Both halves matter. The picker covers the overwhelmingly common cases in one
/// tap, and free text means the feature is not limited to a list someone chose
/// in advance — the API accepts any occasion, so the UI should too.
///
/// Validation here mirrors the server's rules to spare an obvious round trip,
/// but the server remains the authority: a client is never the place where input
/// rules are enforced.
class ValuePicker extends StatelessWidget {
  const ValuePicker({
    required this.label,
    required this.fieldName,
    required this.hint,
    required this.controller,
    required this.options,
    this.icon,
    this.enabled = true,
    super.key,
  });

  final String label;

  /// The API's identifier for this field, so a client-side rejection is worded
  /// exactly like the server's rejection of the same field would be.
  final String fieldName;
  final String hint;
  final TextEditingController controller;
  final List<String> options;
  final IconData? icon;
  final bool enabled;

  static const int _maxLength = 50;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      maxLength: _maxLength,
      textInputAction: TextInputAction.next,
      textCapitalization: TextCapitalization.sentences,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: icon == null ? null : Icon(icon),
        border: const OutlineInputBorder(),
        // The character counter is noise for a field this short; the limit is
        // enforced regardless.
        counterText: '',
        suffixIcon: options.isEmpty
            ? null
            : PopupMenuButton<String>(
                icon: const Icon(Icons.arrow_drop_down),
                tooltip: 'Common choices',
                enabled: enabled,
                onSelected: (value) => controller.text = value,
                itemBuilder: (context) => options
                    .map(
                      (option) => PopupMenuItem<String>(
                        value: option,
                        child: Text(option),
                      ),
                    )
                    .toList(growable: false),
              ),
      ),
      // Mirrors the server's rules so an obvious mistake costs no round trip,
      // and reuses the same localised wording the server's own rejection would
      // produce: the user should not be able to tell which side rejected them.
      validator: (value) {
        final trimmed = (value ?? '').trim();
        if (trimmed.isEmpty) {
          return FieldViolation(
            field: fieldName,
            rule: ValidationRule.required,
          ).message;
        }
        if (trimmed.length < 2) {
          return FieldViolation(
            field: fieldName,
            rule: ValidationRule.tooShort,
          ).message;
        }
        return null;
      },
    );
  }
}
