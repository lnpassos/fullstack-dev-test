import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gift_message_suggester/core/network/failure.dart';
import 'package:gift_message_suggester/features/suggestions/domain/suggestions_repository.dart';
import 'package:gift_message_suggester/features/suggestions/presentation/providers.dart';
import 'package:gift_message_suggester/features/suggestions/presentation/suggestions_screen.dart';

import '../../../helpers/fake_repository.dart';

/// What the user actually sees, for each state the screen can be in.
void main() {
  Future<void> pumpScreen(
    WidgetTester tester,
    SuggestionsRepository repository,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          suggestionsRepositoryProvider.overrideWithValue(repository),
        ],
        child: const MaterialApp(home: SuggestionsScreen()),
      ),
    );
    // Lets the options future resolve.
    await tester.pump();
  }

  /// Fills the two fields by position rather than by label.
  ///
  /// The labels are localised, so looking them up by text would tie every test
  /// to English and make the Portuguese cases below impossible to write with the
  /// same helper.
  Future<void> fillForm(
    WidgetTester tester, {
    String occasion = 'Birthday',
    String relationship = 'Friend',
  }) async {
    final fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), occasion);
    await tester.enterText(fields.at(1), relationship);
  }

  Future<void> tapSubmit(WidgetTester tester) async {
    await tester.tap(find.byType(FilledButton));
  }

  testWidgets('starts with an empty state and the form', (tester) async {
    await pumpScreen(tester, FakeRepository());

    expect(find.text('Gift Card Message Suggester'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Occasion'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Relationship'), findsOneWidget);
    expect(find.text('Get suggestions'), findsOneWidget);
    expect(find.textContaining('a few messages for the card'), findsOneWidget);
  });

  testWidgets('Birthday + Friend shows suggestions end to end', (tester) async {
    final repository = FakeRepository();
    await pumpScreen(tester, repository);

    await fillForm(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(find.text('Suggestions'), findsOneWidget);
    expect(find.text('Wishing you the happiest of birthdays.'), findsOneWidget);
    expect(find.text('Hope your day is as good as you are.'), findsOneWidget);
    expect(find.text('Here is to a year worth celebrating.'), findsOneWidget);

    expect(repository.received, hasLength(1));
    expect(repository.received.single.occasion, 'Birthday');
    expect(repository.received.single.relationship, 'Friend');
  });

  testWidgets('shows a loading state while the request is in flight', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      FakeRepository(delay: const Duration(milliseconds: 200)),
    );

    await fillForm(tester);
    await tapSubmit(tester);
    await tester.pump();

    expect(find.text('Getting suggestions…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.bySemanticsLabel('Loading suggestions'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.text('Getting suggestions…'), findsNothing);
  });

  testWidgets('disables the button while loading', (tester) async {
    await pumpScreen(
      tester,
      FakeRepository(delay: const Duration(milliseconds: 200)),
    );

    await fillForm(tester);
    await tapSubmit(tester);
    await tester.pump();

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);

    await tester.pumpAndSettle();
  });

  /// The behaviour the whole fallback design exists for: the user still gets
  /// messages, and is told they are the standard ones.
  testWidgets('shows the degraded notice above fallback suggestions', (
    tester,
  ) async {
    await pumpScreen(
      tester,
      FakeRepository(result: FakeRepository.defaultResult(degraded: true)),
    );

    await fillForm(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(
      find.textContaining('Showing our standard messages'),
      findsOneWidget,
    );
    // Degraded is not an error: the suggestions are still there.
    expect(find.text('Wishing you the happiest of birthdays.'), findsOneWidget);
  });

  testWidgets('does not show the notice for a normal response', (tester) async {
    await pumpScreen(tester, FakeRepository());

    await fillForm(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(find.textContaining('Showing our standard messages'), findsNothing);
  });

  group('failures', () {
    testWidgets('shows a message and a retry for a network failure', (
      tester,
    ) async {
      await pumpScreen(tester, FakeRepository(failure: const NetworkFailure()));

      await fillForm(tester);
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(find.textContaining('Could not reach the server'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('retry recovers once the server answers', (tester) async {
      await pumpScreen(tester, FlakyRepository());

      await fillForm(tester);
      await tapSubmit(tester);
      await tester.pumpAndSettle();
      expect(find.text('Try again'), findsOneWidget);

      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(
        find.text('Wishing you the happiest of birthdays.'),
        findsOneWidget,
      );
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('offers no retry for input the server rejected', (
      tester,
    ) async {
      await pumpScreen(
        tester,
        FakeRepository(
          failure: const ValidationFailure(
            violations: [
              FieldViolation(
                field: 'occasion',
                rule: ValidationRule.invalidFormat,
              ),
            ],
          ),
        ),
      );

      await fillForm(tester, occasion: 'Birthday');
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(
        find.text('Occasion contains characters we cannot use.'),
        findsOneWidget,
      );
      // Retrying the same rejected request would be rejected identically.
      expect(find.text('Try again'), findsNothing);
    });

    testWidgets('explains a rate limit', (tester) async {
      await pumpScreen(
        tester,
        FakeRepository(failure: const RateLimitedFailure()),
      );

      await fillForm(tester);
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(find.textContaining('Too many requests'), findsOneWidget);
    });

    testWidgets('quotes the request id on a server failure', (tester) async {
      await pumpScreen(
        tester,
        FakeRepository(failure: const ServerFailure(requestId: 'abc-123')),
      );

      await fillForm(tester);
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      // The one internal detail worth showing: it makes a bug report actionable.
      expect(find.textContaining('abc-123'), findsOneWidget);
    });
  });

  group('client-side validation', () {
    testWidgets('blocks an empty form without calling the API', (tester) async {
      final repository = FakeRepository();
      await pumpScreen(tester, repository);

      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(find.text('Please enter Occasion.'), findsOneWidget);
      expect(find.text('Please enter Relationship.'), findsOneWidget);
      expect(repository.received, isEmpty);
    });

    testWidgets('blocks a single character', (tester) async {
      final repository = FakeRepository();
      await pumpScreen(tester, repository);

      await fillForm(tester, occasion: 'x');
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(
        find.text('Occasion must be at least 2 characters.'),
        findsOneWidget,
      );
      expect(repository.received, isEmpty);
    });

    testWidgets('trims whitespace before sending', (tester) async {
      final repository = FakeRepository();
      await pumpScreen(tester, repository);

      await fillForm(
        tester,
        occasion: '  Birthday  ',
        relationship: '  Friend ',
      );
      await tapSubmit(tester);
      await tester.pumpAndSettle();

      expect(repository.received.single.occasion, 'Birthday');
      expect(repository.received.single.relationship, 'Friend');
    });
  });

  testWidgets('sends the selected tone', (tester) async {
    final repository = FakeRepository();
    await pumpScreen(tester, repository);

    await fillForm(tester);
    await tester.tap(find.text('Funny'));
    await tester.pump();
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(repository.received.single.tone, 'funny');
  });

  testWidgets('falls back to built-in options when the server has none', (
    tester,
  ) async {
    // The pickers are a convenience; the screen must render regardless.
    await pumpScreen(tester, FakeRepository());

    await tester.tap(find.byTooltip('Common choices').first);
    await tester.pumpAndSettle();

    expect(find.text('Birthday').hitTestable(), findsOneWidget);
  });
}
