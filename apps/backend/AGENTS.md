# Future .NET API

This directory is reserved for MAZ-51 onward. Preserve `contracts/openapi.json`, the existing SQLite data and the legacy Expo clients until explicit cutover gates pass. Use real HTTP and temporary SQLite integration tests for auth, ownership, revisions, migration and rollback. Keep one active database writer. The root Expo guidance applies to the legacy Expo app, not to .NET code here.
