package dev.aec.sms;

import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.SingleUseObjectProvider;

/** One-time SMS codes with TTL, plus per-phone limits on code requests and failed checks. */
final class CodeStore {
  static final int MAX_SENDS = 5;
  static final int MAX_FAILURES = 5;
  static final int WINDOW_SECONDS = 600;
  private static final SecureRandom RANDOM = new SecureRandom();
  /** Stand-only outbox: the last code sent to each phone. Replaces the SMS gateway. */
  static final Map<String, String> OUTBOX = new ConcurrentHashMap<>();

  private final SingleUseObjectProvider store;
  private final String realm;

  CodeStore(KeycloakSession session, String realm) {
    this.store = session.singleUseObjects();
    this.realm = realm;
  }

  static int ttlSeconds() {
    String v = System.getenv("SMS_CODE_TTL_SECONDS");
    return v == null || v.isBlank() ? 300 : Integer.parseInt(v.trim());
  }

  static String normalize(String phone) {
    if (phone == null) return "";
    String digits = phone.replaceAll("\\D", "");
    return digits.isEmpty() ? "" : "+" + digits;
  }

  private String key(String kind, String phone) {
    return "sms-" + kind + ":" + realm + ":" + phone;
  }

  private int bump(String kind, String phone) {
    String k = key(kind, phone);
    Map<String, String> cur = store.get(k);
    int n = cur == null ? 1 : Integer.parseInt(cur.getOrDefault("n", "0")) + 1;
    Map<String, String> next = new HashMap<>();
    next.put("n", Integer.toString(n));
    if (cur == null) store.put(k, WINDOW_SECONDS, next);
    else store.replace(k, next);
    return n;
  }

  private int count(String kind, String phone) {
    Map<String, String> cur = store.get(key(kind, phone));
    return cur == null ? 0 : Integer.parseInt(cur.getOrDefault("n", "0"));
  }

  /** Returns false when the phone hit the send limit. */
  boolean issue(String phone) {
    if (bump("sends", phone) > MAX_SENDS) return false;
    String code = String.format("%06d", RANDOM.nextInt(1_000_000));
    store.remove(key("code", phone));
    store.put(key("code", phone), ttlSeconds(), Map.of("code", code));
    OUTBOX.put(realm + ":" + phone, code);
    return true;
  }

  enum Check { OK, WRONG, EXPIRED, LOCKED }

  /** Single use: a correct code is consumed; wrong guesses count against the phone. */
  Check verify(String phone, String code) {
    if (count("fails", phone) >= MAX_FAILURES) return Check.LOCKED;
    Map<String, String> stored = store.get(key("code", phone));
    if (stored == null) {
      bump("fails", phone);
      return Check.EXPIRED;
    }
    if (!stored.get("code").equals(code)) {
      return bump("fails", phone) >= MAX_FAILURES ? Check.LOCKED : Check.WRONG;
    }
    store.remove(key("code", phone));
    return Check.OK;
  }
}
