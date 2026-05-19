import struct

from network.ac_packet import ACSP, PacketParser


def test_read_uint8_and_uint16():
    data = struct.pack("<BH", 51, 0xABCD)
    parser = PacketParser(data)
    assert parser.read_uint8() == ACSP.NEW_CONNECTION
    assert parser.read_uint16() == 0xABCD


def test_read_string():
    payload = b"\x05hello"
    parser = PacketParser(payload)
    assert parser.read_string() == "hello"


def test_read_string_empty():
    parser = PacketParser(b"\x00")
    assert parser.read_string() == ""


def test_remaining():
    parser = PacketParser(b"\x01\x02\x03")
    parser.read_uint8()
    assert parser.remaining() == 2
