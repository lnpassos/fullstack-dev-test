import 'package:flutter/material.dart';

/// unexplained blank space.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Column(
        children: [
          Icon(
            Icons.card_giftcard,
            size: 44,
            color: theme.colorScheme.outlineVariant,
          ),
          const SizedBox(height: 14),
          Text(
            'Tell us the occasion and who the gift is for,'
            '\nand we will suggest a few messages for the card.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
        ],
      ),
    );
  }
}
