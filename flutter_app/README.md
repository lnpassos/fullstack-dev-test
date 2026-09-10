# Flutter client

The app half of the gift card message suggester. Run instructions, architecture
and the reasoning behind the design choices are in the
[root README](../README.md).

```bash
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8080
```

`API_BASE_URL` defaults to `http://localhost:8080`. An Android emulator needs
`http://10.0.2.2:8080` — it cannot reach the host's `localhost`.

```bash
flutter analyze
flutter test
```

## Layout

```
lib/
├── core/
│   ├── config/      build-time configuration (--dart-define)
│   └── network/     the failure hierarchy
└── features/suggestions/
    ├── domain/      entities + the repository interface
    ├── data/        HTTP implementation; the only file that knows the API exists
    └── presentation/ sealed state · Riverpod controller · screen · widgets
```

A degraded response — the server served curated messages because the model was
unavailable — is a **success** carrying `degraded: true`, rendered as suggestions
under a notice. It is deliberately not modelled as an error: doing so would throw
away a perfectly usable answer.
