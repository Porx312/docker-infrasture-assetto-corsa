from unittest.mock import MagicMock, patch

from core.cm_name import CM_SUFFIX_SEP
from network.event_dispatcher import build_envelope, dispatch_battle_webhook, send_server_event


def test_build_envelope_shape():
    envelope = build_envelope("player_join", "ProjectD", {"steamId": "abc"})
    assert envelope["event"] == "player_join"
    assert envelope["serverName"] == "ProjectD"
    assert envelope["data"]["steamId"] == "abc"
    assert "eventId" in envelope
    assert "ts" in envelope
    assert envelope["schemaVersion"]


@patch("network.event_dispatcher._enqueue")
def test_dispatch_battle_webhook_prefers_display_server_name(mock_enqueue):
    server_state = MagicMock()
    server_state.server_folder_id = "server-2"
    server_state.config_server_name = "battle test"
    server_state.server_name = "AC Server"
    server_state.track = "tsukuba"
    server_state.config = "fr"

    dispatch_battle_webhook(
        server_state,
        {
            "battle_id": "battle-abc",
            "player1_steam_id": "p1",
            "player2_steam_id": "p2",
            "metadata": {},
        },
        2,
        1,
        "p1",
        [],
    )

    assert mock_enqueue.call_count == 2
    assert mock_enqueue.call_args_list[0].args[1] == "battle test"


@patch("network.event_dispatcher._enqueue")
def test_dispatch_battle_webhook_draw_publishes_finished(mock_enqueue):
    server_state = MagicMock()
    server_state.server_folder_id = "server"
    server_state.config_server_name = "pord"
    server_state.server_name = "pord"
    server_state.track = "pk_akina"
    server_state.config = "akina_downhill"

    dispatch_battle_webhook(
        server_state,
        {
            "battle_id": "battle-draw",
            "player1_steam_id": "p1",
            "player2_steam_id": "p2",
            "metadata": {},
        },
        1,
        1,
        None,
        [],
    )

    assert mock_enqueue.call_count == 2
    assert mock_enqueue.call_args_list[0].args[0] == "battle_update"
    assert mock_enqueue.call_args_list[1].args[0] == "battle_finished"
    payload = mock_enqueue.call_args_list[1].args[2]
    assert payload["status"] == "draw"
    assert "winnerSteamId" not in payload


@patch("network.event_dispatcher._enqueue")
def test_dispatch_battle_webhook_cancelled_does_not_publish_finished(mock_enqueue):
    server_state = MagicMock()
    server_state.config_server_name = "pord"
    server_state.track = "pk_akina"
    server_state.config = "akina_downhill"

    dispatch_battle_webhook(
        server_state,
        {
            "battle_id": "battle-cancel",
            "player1_steam_id": "p1",
            "player2_steam_id": "p2",
            "metadata": {},
        },
        0,
        0,
        None,
        [],
        status="cancelled",
    )

    assert mock_enqueue.call_count == 1
    assert mock_enqueue.call_args_list[0].args[0] == "battle_update"


@patch("network.event_dispatcher._enqueue")
def test_send_server_event_strips_cm_suffix(mock_enqueue):
    send_server_event("player_join", f"projectd {CM_SUFFIX_SEP}18081", {"steamId": "x"})
    mock_enqueue.assert_called_once_with(
        "player_join", "projectd", {"steamId": "x"}
    )


@patch("network.event_dispatcher._enqueue")
def test_dispatch_battle_webhook_strips_suffix_in_stream_and_payload(mock_enqueue):
    server_state = MagicMock()
    server_state.config_server_name = f"projectd {CM_SUFFIX_SEP}18081"
    server_state.server_name = f"projectd {CM_SUFFIX_SEP}18081"

    dispatch_battle_webhook(
        server_state,
        {
            "battle_id": "b1",
            "player1_steam_id": "p1",
            "player2_steam_id": "p2",
            "metadata": {},
        },
        0,
        0,
        None,
        [],
        status="cancelled",
    )

    assert mock_enqueue.call_args_list[0].args[1] == "projectd"
    assert mock_enqueue.call_args_list[0].args[2]["serverName"] == "projectd"
