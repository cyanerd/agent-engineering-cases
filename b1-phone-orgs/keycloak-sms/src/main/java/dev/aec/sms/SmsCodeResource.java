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
    if (!new CodeStore(session, realm).issue(phone)) return Response.status(429).entity(Map.of("error", "too_many_requests")).type(MediaType.APPLICATION_JSON).build();
    return Response.noContent().build();
  }

  @GET
  @Path("outbox")
  @Produces(MediaType.APPLICATION_JSON)
  public Response outbox(@QueryParam("phone") String phone) {
    if (!"true".equals(System.getenv("SMS_STUB_OUTBOX"))) return Response.status(404).build();
    String code = CodeStore.OUTBOX.get(session.getContext().getRealm().getName() + ":" + CodeStore.normalize(phone));
    return code == null ? Response.status(404).build() : Response.ok(Map.of("code", code)).build();
  }

  @Override
  public void close() {}
}
