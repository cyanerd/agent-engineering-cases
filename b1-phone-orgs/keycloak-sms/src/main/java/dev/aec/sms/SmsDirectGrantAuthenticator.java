package dev.aec.sms;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.keycloak.authentication.AuthenticationFlowContext;
import org.keycloak.authentication.AuthenticationFlowError;
import org.keycloak.authentication.Authenticator;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Direct grant by phone + SMS code. Realm attribute smsMode selects the behaviour:
 * naive - the first user with this phone attribute (what a first implementation usually does);
 * fixed - exactly one person owns a verified phone; a long-verified phone on an unknown device needs a second factor.
 */
public class SmsDirectGrantAuthenticator implements Authenticator {
  static final Duration REVERIFY_AFTER = Duration.ofDays(90);

  private static void fail(AuthenticationFlowContext ctx, AuthenticationFlowError kind, String error, String description) {
    Response r = Response.status(400).entity(Map.of("error", error, "error_description", description)).type(MediaType.APPLICATION_JSON).build();
    ctx.failure(kind, r);
  }

  @Override
  public void authenticate(AuthenticationFlowContext ctx) {
    MultivaluedMap<String, String> form = ctx.getHttpRequest().getDecodedFormParameters();
    String phone = CodeStore.normalize(form.getFirst("phone"));
    String code = form.getFirst("code");
    String device = form.getFirst("device_id");
    RealmModel realm = ctx.getRealm();
    if (phone.isEmpty() || code == null) {
      fail(ctx, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_request", "phone and code are required");
      return;
    }
    switch (new CodeStore(ctx.getSession(), realm.getName()).verify(phone, code)) {
      case LOCKED -> { fail(ctx, AuthenticationFlowError.INVALID_CREDENTIALS, "too_many_attempts", "too many wrong codes, try later"); return; }
      case EXPIRED -> { fail(ctx, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_grant", "code expired or not requested"); return; }
      case WRONG -> { fail(ctx, AuthenticationFlowError.INVALID_CREDENTIALS, "invalid_grant", "wrong code"); return; }
      case OK -> {}
    }
    KeycloakSession session = ctx.getSession();
    List<UserModel> users = session.users().searchForUserByUserAttributeStream(realm, "phone", phone).filter(UserModel::isEnabled).toList();
    if ("fixed".equals(realm.getAttribute("smsMode"))) {
      List<UserModel> owners = users.stream().filter(u -> "true".equals(u.getFirstAttribute("phoneVerified"))).toList();
      if (owners.isEmpty()) { fail(ctx, AuthenticationFlowError.INVALID_USER, "unknown_phone", "no person owns this phone"); return; }
      if (owners.size() > 1) { fail(ctx, AuthenticationFlowError.INVALID_USER, "ambiguous_phone", "phone belongs to more than one person"); return; }
      UserModel person = owners.get(0);
      String verifiedAt = person.getFirstAttribute("phoneVerifiedAt");
      List<String> known = person.getAttributeStream("knownDevices").toList();
      boolean stale = verifiedAt == null || Instant.parse(verifiedAt).isBefore(Instant.now().minus(REVERIFY_AFTER));
      if (stale && (device == null || !known.contains(device))) {
        fail(ctx, AuthenticationFlowError.INVALID_CREDENTIALS, "step_up_required", "phone verified long ago and device is new: confirm with a second factor");
        return;
      }
      ctx.setUser(person);
    } else {
      if (users.isEmpty()) { fail(ctx, AuthenticationFlowError.INVALID_USER, "invalid_grant", "unknown phone"); return; }
      ctx.setUser(users.get(0));
    }
    ctx.success();
  }

  @Override
  public void action(AuthenticationFlowContext ctx) {}

  @Override
  public boolean requiresUser() {
    return false;
  }

  @Override
  public boolean configuredFor(KeycloakSession session, RealmModel realm, UserModel user) {
    return true;
  }

  @Override
  public void setRequiredActions(KeycloakSession session, RealmModel realm, UserModel user) {}

  @Override
  public void close() {}
}
