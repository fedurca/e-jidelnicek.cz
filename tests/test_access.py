from fastapi.testclient import TestClient

from app import app
from jidelnicek.access import (
    client_ip,
    code_matches,
    ip_allowed,
    session_matches,
    session_token,
    sha256_text,
)


def test_only_the_home_ip_and_loopback_pass():
    allowed = {"185.22.236.11"}
    assert ip_allowed("185.22.236.11", allowed, loopback=True)
    assert ip_allowed("127.0.0.1", allowed, loopback=True)
    assert not ip_allowed("185.22.236.12", allowed, loopback=True)
    assert not ip_allowed("127.0.0.1", allowed, loopback=False)


def test_forwarded_ip_is_used_only_when_the_proxy_is_trusted():
    assert client_ip("10.0.0.8", "185.22.236.11, 10.0.0.8", trust=True) == "185.22.236.11"
    assert client_ip("10.0.0.8", "185.22.236.11", trust=False) == "10.0.0.8"


def test_cloudflare_ip_ignores_a_spoofed_forwarded_header():
    seen = client_ip(
        "127.0.0.1",
        "185.22.236.11",
        trust=False,
        cf_connecting_ip="8.8.8.8",
        trust_cf=True,
    )
    assert seen == "8.8.8.8"
    assert client_ip("127.0.0.1", "185.22.236.11", trust=False, trust_cf=True) == ""


def test_http_gate_blocks_other_ips_and_accepts_the_code(monkeypatch):
    monkeypatch.setenv("ACCESS_UUID", "test-code")
    monkeypatch.setenv("ALLOWED_IPS", "185.22.236.11")
    monkeypatch.setenv("ALLOW_LOOPBACK", "0")
    monkeypatch.setenv("TRUST_PROXY", "1")
    client = TestClient(app)
    home_ip = {"X-Forwarded-For": "185.22.236.11"}

    blocked = client.get("/", headers={"X-Forwarded-For": "8.8.8.8"})
    assert blocked.status_code == 403
    assert "8.8.8.8" in blocked.text

    login = client.get("/vstup", headers=home_ip, follow_redirects=False)
    assert login.status_code == 200
    csrf = client.cookies.get("obed_csrf")
    wrong = client.post("/vstup", data={"csrf": csrf, "kod": "spatne"}, headers=home_ip)
    assert wrong.status_code == 401

    ok = client.post(
        "/vstup",
        data={"csrf": csrf, "kod": "test-code"},
        headers=home_ip,
        follow_redirects=False,
    )
    assert ok.status_code == 303
    assert ok.headers["location"] == "/"
    assert client.cookies.get("obed_vstup")


def test_http_gate_uses_cloudflare_ip_not_the_forwarded_header(monkeypatch):
    monkeypatch.setenv("ACCESS_UUID", "test-code")
    monkeypatch.setenv("ALLOWED_IPS", "185.22.236.11")
    monkeypatch.setenv("ALLOW_LOOPBACK", "0")
    monkeypatch.setenv("TRUST_PROXY", "0")
    monkeypatch.setenv("TRUST_CLOUDFLARE", "1")
    client = TestClient(app)

    spoofed = client.get("/", headers={"X-Forwarded-For": "185.22.236.11"})
    assert spoofed.status_code == 403

    blocked = client.get("/", headers={"CF-Connecting-IP": "8.8.8.8", "X-Forwarded-For": "185.22.236.11"})
    assert blocked.status_code == 403

    home = client.get("/vstup", headers={"CF-Connecting-IP": "185.22.236.11"}, follow_redirects=False)
    assert home.status_code == 200


def test_code_is_checked_by_hash_and_opens_a_session():
    code = "11111111-1111-4111-8111-111111111111"
    digest = sha256_text(code)
    assert code_matches(code, digest)
    assert not code_matches(code + "x", digest)
    token = session_token(digest)
    assert session_matches(token, digest)
    assert not session_matches(token, sha256_text("jiny-kod"))
