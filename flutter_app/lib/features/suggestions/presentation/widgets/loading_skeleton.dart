import 'package:flutter/material.dart';

/// is already known, so the layout does not jump when it arrives.
class LoadingSkeleton extends StatelessWidget {
  const LoadingSkeleton({this.count = 3, super.key});

  final int count;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      label: 'Loading suggestions',
      child: Column(
        children: List.generate(
          count,
          (index) => Container(
            height: 68,
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(12),
            ),
          ),
        ),
      ),
    );
  }
}
