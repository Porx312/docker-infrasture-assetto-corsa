from core.cm_name import CM_SUFFIX_SEP, display_server_name, strip_cm_name_suffix


def test_strip_cm_suffix_unicode():
    assert strip_cm_name_suffix(f"projectd {CM_SUFFIX_SEP}18081") == "projectd"


def test_strip_unchanged_without_suffix():
    assert strip_cm_name_suffix("ProjectD | Akina") == "ProjectD | Akina"


def test_strip_empty():
    assert strip_cm_name_suffix("") == ""


def test_display_server_name_prefers_config():
    class State:
        config_server_name = f"battle test {CM_SUFFIX_SEP}18082"
        server_name = "AC raw"
        server_folder_id = "server-1"

    assert display_server_name(State()) == "battle test"
