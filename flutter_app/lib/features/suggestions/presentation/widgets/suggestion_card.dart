import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../domain/suggestion.dart';

/// One suggested message.
///
/// Tapping copies it. The whole point of the feature is that someone is about to
/// write this text somewhere else, so copying is the primary action rather than
/// a detail hidden behind a menu.
class SuggestionCard extends StatelessWidget {
  const SuggestionCard({
    required this.suggestion,
    required this.index,
    super.key,
  });

  final Suggestion suggestion;

  /// 1-based position, shown so the list reads as a set of options.
  final int index;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _copy(context),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: theme.colorScheme.secondaryContainer,
                child: Text(
                  '$index',
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(suggestion.text, style: theme.textTheme.bodyLarge),
              ),
              const SizedBox(width: 8),
              // Decorative: the row is already one tappable target, and a second
              // focusable control here would make the list tedious to traverse
              // with a keyboard or screen reader.
              Icon(
                Icons.copy_rounded,
                size: 18,
                color: theme.colorScheme.outline,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _copy(BuildContext context) async {
    // Resolved before the await: afterwards this context may be gone.
    final messenger = ScaffoldMessenger.of(context);

    await Clipboard.setData(ClipboardData(text: suggestion.text));

    if (!context.mounted) return;
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Message copied'),
        duration: Duration(seconds: 2),
      ),
    );
  }
}
