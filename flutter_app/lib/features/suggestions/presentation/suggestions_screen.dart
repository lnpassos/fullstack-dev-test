import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/suggestion.dart';
import 'providers.dart';
import 'suggestions_state.dart';
import 'widgets/degraded_banner.dart';
import 'widgets/empty_state.dart';
import 'widgets/failure_view.dart';
import 'widgets/loading_skeleton.dart';
import 'widgets/suggestion_card.dart';
import 'widgets/value_picker.dart';

/// The single screen: inputs, a request, and the results.
///
/// It renders whatever state the controller hands it and nothing more — no
/// network calls, no query building, no error interpretation. That is what makes
/// every state reachable in a widget test by overriding one provider.
class SuggestionsScreen extends ConsumerStatefulWidget {
  const SuggestionsScreen({super.key});

  @override
  ConsumerState<SuggestionsScreen> createState() => _SuggestionsScreenState();
}

class _SuggestionsScreenState extends ConsumerState<SuggestionsScreen> {
  final _formKey = GlobalKey<FormState>();
  final _occasionController = TextEditingController();
  final _relationshipController = TextEditingController();
  String _tone = 'warm';

  @override
  void dispose() {
    _occasionController.dispose();
    _relationshipController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // Client-side validation first, to avoid a round trip for something the
    // user can see is wrong. The server validates again regardless.
    if (!(_formKey.currentState?.validate() ?? false)) return;

    // Dismiss the keyboard: on a phone it would otherwise cover the results.
    FocusScope.of(context).unfocus();

    await ref
        .read(suggestionsControllerProvider.notifier)
        .request(
          SuggestionQuery(
            occasion: _occasionController.text.trim(),
            relationship: _relationshipController.text.trim(),
            tone: _tone,
          ),
        );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(suggestionsControllerProvider);
    final isLoading = state is SuggestionsLoading;

    // The pickers never fail — the repository falls back to built-in values —
    // so there is no error branch to render here.
    final options = ref
        .watch(suggestionOptionsProvider)
        .maybeWhen(
          data: (value) => value,
          orElse: () => SuggestionOptions.defaults,
        );

    return Scaffold(
      appBar: AppBar(
        title: const Text('Gift Card Message Suggester'),
        centerTitle: false,
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            // Readable line length on a wide window: full-width body text on a
            // desktop browser is unpleasant to read.
            constraints: const BoxConstraints(maxWidth: 560),
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _Form(
                  formKey: _formKey,
                  occasionController: _occasionController,
                  relationshipController: _relationshipController,
                  options: options,
                  tone: _tone,
                  onToneChanged: (value) => setState(() => _tone = value),
                  isLoading: isLoading,
                  onSubmit: _submit,
                ),
                const SizedBox(height: 28),
                _Results(state: state),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Form extends StatelessWidget {
  const _Form({
    required this.formKey,
    required this.occasionController,
    required this.relationshipController,
    required this.options,
    required this.tone,
    required this.onToneChanged,
    required this.isLoading,
    required this.onSubmit,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController occasionController;
  final TextEditingController relationshipController;
  final SuggestionOptions options;
  final String tone;
  final ValueChanged<String> onToneChanged;
  final bool isLoading;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Form(
      key: formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ValuePicker(
            label: 'Occasion',
            fieldName: 'occasion',
            hint: 'e.g. Birthday',
            controller: occasionController,
            options: options.occasions,
            icon: Icons.celebration_outlined,
            enabled: !isLoading,
          ),
          const SizedBox(height: 16),
          ValuePicker(
            label: 'Relationship',
            fieldName: 'relationship',
            hint: 'e.g. Friend',
            controller: relationshipController,
            options: options.relationships,
            icon: Icons.people_outline,
            enabled: !isLoading,
          ),
          const SizedBox(height: 16),
          _ToneSelector(
            tones: options.tones,
            selected: tone,
            onChanged: onToneChanged,
            enabled: !isLoading,
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 50,
            child: FilledButton.icon(
              // Disabled while in flight: the controller already ignores a
              // superseded response, but a button that visibly does nothing is
              // still better than one that looks broken.
              onPressed: isLoading ? null : onSubmit,
              icon: isLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_awesome),
              label: Text(
                isLoading ? 'Getting suggestions…' : 'Get suggestions',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ToneSelector extends StatelessWidget {
  const _ToneSelector({
    required this.tones,
    required this.selected,
    required this.onChanged,
    required this.enabled,
  });

  final List<String> tones;
  final String selected;
  final ValueChanged<String> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Tone', style: theme.textTheme.labelLarge),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: tones
              .map(
                (tone) => ChoiceChip(
                  label: Text(_capitalise(tone)),
                  selected: tone == selected,
                  onSelected: enabled ? (_) => onChanged(tone) : null,
                ),
              )
              .toList(growable: false),
        ),
      ],
    );
  }

  String _capitalise(String value) =>
      value.isEmpty ? value : value[0].toUpperCase() + value.substring(1);
}

class _Results extends ConsumerWidget {
  const _Results({required this.state});

  final SuggestionsState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Exhaustive over the sealed state: a new state becomes a compile error
    // here rather than an empty area on screen.
    return switch (state) {
      SuggestionsIdle() => const EmptyState(),

      // A refresh keeps the previous suggestions on screen; only the first load
      // shows placeholders.
      SuggestionsLoading(:final previous?) => _SuggestionList(
        result: previous,
        isStale: true,
      ),
      SuggestionsLoading() => const LoadingSkeleton(),

      SuggestionsReady(:final result) => _SuggestionList(
        result: result,
        isStale: false,
      ),

      SuggestionsFailed(:final failure) => FailureView(
        failure: failure,
        onRetry: () => ref.read(suggestionsControllerProvider.notifier).retry(),
      ),
    };
  }
}

class _SuggestionList extends StatelessWidget {
  const _SuggestionList({required this.result, required this.isStale});

  final SuggestionResult result;

  /// True while a newer request is in flight over these results.
  final bool isStale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('Suggestions', style: theme.textTheme.titleMedium),
            const Spacer(),
            Text('Tap to copy', style: theme.textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 12),

        // The one place the degraded flag surfaces to the user.
        if (result.degraded) const DegradedBanner(),

        Opacity(
          opacity: isStale ? 0.5 : 1,
          child: Column(
            children: [
              for (final (index, suggestion) in result.suggestions.indexed)
                SuggestionCard(suggestion: suggestion, index: index + 1),
            ],
          ),
        ),
      ],
    );
  }
}
