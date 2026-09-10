import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/suggestions/presentation/suggestions_screen.dart';

void main() {
  runApp(const ProviderScope(child: GiftMessageSuggesterApp()));
}

class GiftMessageSuggesterApp extends StatelessWidget {
  const GiftMessageSuggesterApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      // Shown by the OS task switcher before any locale is resolved, so it
      // cannot come from the ARB files. Every string the user reads inside the
      // app does.
      title: 'Gift Card Message Suggester',
      debugShowCheckedModeBanner: false,
      theme: _theme(Brightness.light),
      darkTheme: _theme(Brightness.dark),
      home: const SuggestionsScreen(),
    );
  }

  /// One seeded Material 3 scheme for both brightnesses, so the app follows the
  /// system setting without a second palette to keep in sync.
  ThemeData _theme(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF6750A4),
      brightness: brightness,
    );

    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: scheme.surfaceTint,
        elevation: 0,
        scrolledUnderElevation: 2,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: const InputDecorationTheme(filled: true),
    );
  }
}
