import 'dart:math';

/// Generates the correlation id the app sends as `X-Request-Id`.
///
/// The trace starts here rather than at the server so that a request which never
/// arrives — a dropped connection, a timeout — still has an id the user can
/// quote and the client logs can be searched by. A server-generated id only
/// exists for requests the server actually saw, which excludes the failures
/// people are most likely to report.
///
/// Written by hand instead of pulling in a `uuid` dependency: this is 128 bits
/// of `Random.secure()` formatted as a v4 UUID, and the value only ever has to
/// be unique, never unguessable-in-a-security-sense.
String newRequestId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));

  // Version 4, variant 1 — so the value is a well-formed UUID for whatever log
  // pipeline ends up parsing it.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  final hex = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}'
      '-${hex.substring(16, 20)}-${hex.substring(20)}';
}
