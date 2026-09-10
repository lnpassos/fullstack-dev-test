import 'package:flutter/foundation.dart';

/// Build-time configuration.
///
/// Supplied with `--dart-define`, not read from a bundled file: anything shipped
/// inside the app is trivially readable by whoever installs it, so this is only
/// ever non-secret configuration. The API key lives on the server, which is the
/// main reason the server exists at all.
///
///     flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8080
class AppConfig {
  const AppConfig._();

  /// Base URL of the suggestion API, without a trailing slash.
  ///
  /// Set it explicitly for anything but a local backend:
  ///
  ///     flutter run --dart-define=API_BASE_URL=https://api.example.com
  static String get apiBaseUrl =>
      _explicitBaseUrl.isNotEmpty ? _explicitBaseUrl : _localBackendUrl;

  static const String _explicitBaseUrl = String.fromEnvironment('API_BASE_URL');

  /// Where a backend on the developer's own machine lives, per platform.
  ///
  /// An Android emulator runs behind its own NAT: `localhost` there is the
  /// emulated device, not the host, and the host is reachable at `10.0.2.2`.
  /// Defaulting to that rather than documenting it means someone who opens the
  /// project in an IDE and presses Run gets a working app instead of "could not
  /// reach the server" and a search for why.
  static String get _localBackendUrl {
    if (kIsWeb) return 'http://localhost:8080';
    return defaultTargetPlatform == TargetPlatform.android
        ? 'http://10.0.2.2:8080'
        : 'http://localhost:8080';
  }

  /// Client-side deadline for one API call.
  ///
  /// Deliberately generous, because of what it means when it fires. The server
  /// has its own total budget and always answers inside it — with suggestions,
  /// or with the curated fallback. So if this deadline is the one that expires,
  /// the correct reading is "the server never answered at all", not "the model
  /// was slow".
  ///
  /// A shorter value quietly changes that meaning. At 20s against a server
  /// budget of 45s, a request that generated real suggestions in 24s was
  /// reported to the user as *"the request took too long"* — a success turned
  /// into a failure by the client's impatience. Observed on an emulator while
  /// the Gemini free tier was congested, which is exactly when it matters.
  ///
  /// 60s clears every budget this project suggests, so the server stays the
  /// binding constraint. Lower it only if you also lower `LLM_TOTAL_BUDGET_MS`.
  ///
  ///     flutter run --dart-define=REQUEST_TIMEOUT_SECONDS=90
  static const Duration requestTimeout = Duration(
    seconds: int.fromEnvironment('REQUEST_TIMEOUT_SECONDS', defaultValue: 60),
  );
}
