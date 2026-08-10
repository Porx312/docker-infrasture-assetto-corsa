"""Tests for disabled notify flags."""

from unittest.mock import patch

from core.user_prefs_notify import notify_pref_change
from core.user_registration_welcome import notify_registered_welcome


@patch("core.user_prefs_notify.settings.USER_PREFS_NOTIFY_ENABLED", False)
def test_notify_pref_change_disabled():
    assert notify_pref_change("76561199000000001", "acceptBattle", False) == 0


@patch("core.user_registration_welcome.settings.USER_REGISTERED_WELCOME_ENABLED", False)
def test_notify_registered_welcome_disabled():
    assert notify_registered_welcome("76561199000000001") == 0
