import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gift_message_suggester/core/config/app_config.dart';

/// The base URL default is the difference between a reviewer pressing Run and
/// seeing the app work, and seeing "could not reach the server" with no clue
/// that `localhost` on an Android emulator means the emulator itself.
void main() {
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
  });

  test('reaches the host machine from an Android emulator', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;

    // An emulator runs behind its own NAT: `localhost` there is the emulated
    // device. `10.0.2.2` is the host, and getting this wrong looks exactly like
    // a backend that is down.
    expect(AppConfig.apiBaseUrl, 'http://10.0.2.2:8080');
  });

  test('uses localhost everywhere else', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;

    expect(AppConfig.apiBaseUrl, 'http://localhost:8080');
  });

  test('outlasts every server budget this project suggests', () {
    // The server always answers inside its own total budget — with suggestions
    // or with the fallback. If the client's deadline is shorter, it discards an
    // answer the server produced and reports a success as a failure.
    //
    // 45s is the highest `LLM_TOTAL_BUDGET_MS` the README recommends for a
    // congested free tier, so the client has to clear it.
    const highestServerBudget = Duration(seconds: 45);
    expect(AppConfig.requestTimeout, greaterThan(highestServerBudget));
  });
}
