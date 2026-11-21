package dev.aec.sms;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.RoleModel;
import org.keycloak.services.managers.AppAuthManager;
import org.keycloak.services.managers.AuthenticationManager;
import org.keycloak.services.resource.RealmResourceProvider;

/** /realms/{realm}/sms/code issues a code; /realms/{realm}/sms/outbox reads it back on the stand only. */
public class SmsCodeResource implements RealmResourceProvider {
  private final KeycloakSession session;

  SmsCodeResource(KeycloakSession session) {
    this.session = session;
  }

  @Override
  public Object getResource() {
    return this;
  }

  @POST
  @Path("code")
  @Consumes(MediaType.APPLICATION_JSON)
  public Response issue(Map<String, String> body) {
    String phone = CodeStore.normalize(body == null ? null : body.get("phone"));
    if (phone.length() < 8) return Response.status(400).entity(Map.of("error", "invalid_phone")).type(MediaType.APPLICATION_JSON).build();
    String realm = session.getContext().getRealm().getName();
    // The response never says whether the phone belongs to someone: no account enumeration.
    String ip = session.getContext().getConnection().getRemoteAddr();
    CodeStore.Issue r = new CodeStore(session, realm).issue(phone, ip);
    if (r != CodeStore.Issue.OK) return Response.status(429).entity(Map.of("error", "too_many_requests")).type(MediaType.APPLICATION_JSON).build();
    return Response.noContent().build();
  }

  @GET
  @Path("outbox")
  @Produces(MediaType.APPLICATION_JSON)
  public Response outbox(@QueryParam("phone") String phone) {
    if (!"true".equals(System.getenv("SMS_STUB_OUTBOX"))) return Response.status(404).build();
    // Even on the stand the outbox is readable only with a master-realm admin token.
    RealmModel master = session.realms().getRealmByName("master");
    RealmModel current = session.getContext().getRealm();
    String realmName = current.getName();
    AuthenticationManager.AuthResult auth;
    session.getContext().setRealm(master);
    try {
      auth = new AppAuthManager.BearerTokenAuthenticator(session).setRealm(master).authenticate();
    } finally {
      session.getContext().setRealm(current);
    }
    if (auth == null) return Response.status(401).build();
    RoleModel admin = master.getRole("admin");
    if (admin == null || !auth.getUser().hasRole(admin)) return Response.status(403).build();
    String code = CodeStore.OUTBOX.get(realmName + ":" + CodeStore.normalize(phone));
    return code == null ? Response.status(404).build() : Response.ok(Map.of("code", code)).build();
  }

  @Override
  public void close() {}
}
