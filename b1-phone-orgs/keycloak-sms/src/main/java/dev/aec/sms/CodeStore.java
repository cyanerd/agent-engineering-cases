package dev.aec.sms;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.SingleUseObjectProvider;

/**
 * One-time SMS codes with TTL and limits per phone and per client IP.
 * Limits are fixed windows made of slots: each attempt atomically claims the next free slot with putIfAbsent,
 * so parallel requests cannot exceed the limit, and the slots expire with their window.
 */
final class CodeStore {
  static final int MAX_SENDS = 5;
  /** Code checks per phone per window, successful ones included: a guess is counted before it is compared. */
  static final int MAX_CHECKS = 5;
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final int OUTBOX_CAP = 10_000;
  /** Stand-only outbox: the last code sent to each phone. Replaces the SMS gateway. Bounded, entries removed on use. */
  static final Map<String, String> OUTBOX = Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, false) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, String> e) {
      return size() > OUTBOX_CAP;
    }
  });

  private final SingleUseObjectProvider store;
  private final String realm;

  CodeStore(KeycloakSession session, String realm) {
    this.store = session.singleUseObjects();
    this.realm = realm;
  }

  private static int env(String name, int fallback) {
    String v = System.getenv(name);
    return v == null || v.isBlank() ? fallback : Integer.parseInt(v.trim());
  }

  static int ttlSeconds() { return env("SMS_CODE_TTL_SECONDS", 300); }
  static int windowSeconds() { return env("SMS_WINDOW_SECONDS", 600); }
  static int ipLimit() { return env("SMS_IP_LIMIT", 30); }

  static String normalize(String phone) {
    if (phone == null) return "";
    String digits = phone.replaceAll("\\D", "");
    return digits.isEmpty() ? "" : "+" + digits;
  }

  private String slotBase(String kind, String subject) {
    long bucket = Instant.now().getEpochSecond() / windowSeconds();
    return "sms-" + kind + ":" + realm + ":" + subject + ":" + bucket + ":";
  }

  /** Claims the next free slot of the current window; false when all max slots are taken. */
  private boolean takeSlot(String kind, String subject, int max) {
    String base = slotBase(kind, subject);
    for (int n = 1; n <= max; n++) if (store.putIfAbsent(base + n, windowSeconds())) return true;
    return false;
  }

  private String codeKey(String phone) {
    return "sms-code:" + realm + ":" + phone;
  }

  enum Issue { OK, PHONE_LIMIT, IP_LIMIT }

  Issue issue(String phone, String clientIp) {
    if (!takeSlot("ip", clientIp == null ? "unknown" : clientIp, ipLimit())) return Issue.IP_LIMIT;
    if (!takeSlot("sends", phone, MAX_SENDS)) return Issue.PHONE_LIMIT;
    String code = String.format("%06d", RANDOM.nextInt(1_000_000));
    store.remove(codeKey(phone));
    store.put(codeKey(phone), ttlSeconds(), Map.of("code", code));
    OUTBOX.put(realm + ":" + phone, code);
    return Issue.OK;
  }

  enum Check { OK, WRONG, EXPIRED, LOCKED }

  private static boolean same(String a, String b) {
    return a != null && b != null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
  }

  /** Single use: only the caller whose remove() returns the entry gets OK. A wrong guess does not burn the code. */
  Check verify(String phone, String code) {
    if (!takeSlot("checks", phone, MAX_CHECKS)) return Check.LOCKED;
    Map<String, String> stored = store.get(codeKey(phone));
    if (stored == null) return Check.EXPIRED;
    if (!same(stored.get("code"), code)) return Check.WRONG;
    Map<String, String> removed = store.remove(codeKey(phone));
    if (removed == null || !same(removed.get("code"), code)) return Check.EXPIRED;
    OUTBOX.remove(realm + ":" + phone);
    return Check.OK;
  }
}
