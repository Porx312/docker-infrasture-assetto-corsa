from core import runtime_config


class _FakeState:
    def __init__(self, folder_id="", config_name="", server_name=""):
        self.server_folder_id = folder_id
        self.config_server_name = config_name
        self.server_name = server_name


def test_set_server_modes_and_lookup():
    runtime_config.set_server_modes(
        [
            {
                "serverName": "server-2",
                "displayName": "ProjectD",
                "type": "battle",
            },
            {
                "serverName": "server-3",
                "displayName": "TimeAttack",
                "type": "time-attack",
                "eventConstraints": {
                    "enableCollisions": True,
                    "detectIdle": True,
                    "maxFails": 3,
                },
            },
        ]
    )
    state = _FakeState(folder_id="server-2", config_name="ProjectD")
    assert runtime_config.get_mode_for_state(state) == "battle"
    assert runtime_config.get_event_constraints_for_state(state) == {}

    ta_state = _FakeState(folder_id="server-3")
    assert runtime_config.get_mode_for_state(ta_state) == "time-attack"
    meta = runtime_config.get_event_constraints_for_state(ta_state)
    assert meta["enableCollisions"] is True
    assert meta["detectIdle"] is True
    assert meta["maxFails"] == 3
