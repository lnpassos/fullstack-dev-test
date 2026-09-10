import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/suggestions_api.dart';
import '../domain/suggestion.dart';
import '../domain/suggestions_repository.dart';
import 'suggestions_controller.dart';
import 'suggestions_state.dart';

/// Dependency wiring — the app's composition root, mirroring `bootstrap.ts` on
/// the server. This is the only file that names both the interface and the HTTP
/// implementation, which is what lets tests override the repository with a
/// single `overrideWithValue`.
final suggestionsRepositoryProvider = Provider<SuggestionsRepository>(
  (ref) => SuggestionsApi(),
);

/// Vocabulary for the pickers.
///
/// Never fails: the repository degrades to built-in defaults, so the screen has
/// no error branch to render for it.
final suggestionOptionsProvider = FutureProvider<SuggestionOptions>(
  (ref) => ref.watch(suggestionsRepositoryProvider).fetchOptions(),
);

final suggestionsControllerProvider =
    NotifierProvider<SuggestionsController, SuggestionsState>(
      SuggestionsController.new,
    );
