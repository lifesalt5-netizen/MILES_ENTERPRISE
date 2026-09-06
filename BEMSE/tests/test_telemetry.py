from bemse.telemetry import EventType, InMemoryTelemetrySink, TelemetryEvent, identity_fingerprint


def test_identity_fingerprint_is_normalized_and_stable():
    assert identity_fingerprint(" Person@Example.com ") == identity_fingerprint("person@example.com")
    assert identity_fingerprint("person@example.com") != "person@example.com"


def test_in_memory_sink_is_bounded():
    sink = InMemoryTelemetrySink(max_events=2)
    sink.emit(TelemetryEvent(event_type=EventType.SEND_ATTEMPTED, payload={"n": 1}))
    sink.emit(TelemetryEvent(event_type=EventType.SEND_ATTEMPTED, payload={"n": 2}))
    sink.emit(TelemetryEvent(event_type=EventType.SEND_ATTEMPTED, payload={"n": 3}))

    events = sink.snapshot(limit=10)
    assert len(events) == 2
    assert [event.payload["n"] for event in events] == [2, 3]


def test_snapshot_limit_returns_latest_events():
    sink = InMemoryTelemetrySink(max_events=10)
    for n in range(5):
        sink.emit(TelemetryEvent(event_type=EventType.GOVERNANCE_ACTION, payload={"n": n}))

    events = sink.snapshot(limit=2)
    assert [event.payload["n"] for event in events] == [3, 4]
