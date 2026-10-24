import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.security.spec.*;
import java.time.Duration;
import java.util.*;

/** HTTP session, JSON and local key persistence only; no new cryptographic scheme. */
public final class ApiClient {
    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.out.println("Usage: java ApiClient setup|requests|fingerprint [url]");
            System.out.println("       java ApiClient request|accept|verify <id> [url]");
            return;
        }
        String action = args[0];
        boolean needsId = action.equals("request") || action.equals("accept") || action.equals("verify");
        if (needsId && args.length < 2) throw new IllegalArgumentException("An ID is required");
        String url = args.length > (needsId ? 2 : 1) ? args[needsId ? 2 : 1] : "http://localhost:3000";
        login(url);
        if (action.equals("setup")) {
            KeyPair keys = receiverKeys();
            // keys() already publishes the authenticated v2 bundle.
            System.out.println("User ID: " + userId);
            System.out.println("Local keys ready.");
        } else if (action.equals("fingerprint")) {
            receiverKeys(); System.out.println("Fingerprint: " + SecurityV2.fingerprint(userId, SecurityV2.remote(userId)));
        } else if (action.equals("verify")) {
            SecurityV2.verifyPeer(args[1]);
        } else {
            HttpResponse<String> response;
            if (action.equals("requests")) response = request("/api/friendships/requests", null);
            else if (action.equals("request")) response = request("/api/friendships/request", "{\"targetUserId\":" + quote(args[1]) + "}");
            else if (action.equals("accept")) response = request("/api/friendships/" + args[1] + "/accept", "{}");
            else throw new IllegalArgumentException("Unknown action: " + action);
            requireSuccess(response); System.out.println(response.body());
        }
    }
    static final HttpClient HTTP = HttpClient.newBuilder()
        .cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .connectTimeout(Duration.ofSeconds(10)).build();
    static String baseUrl;
    static String userId;
    private static final Set<String> seen = new HashSet<>();
    private static Path seenFile;
    static String csrfToken;
    static final BufferedReader INPUT = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));

    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : value.toCharArray()) {
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default: if (c < 32) out.append(String.format("\\u%04x", (int)c)); else out.append(c);
            }
        }
        return out.append('"').toString();
    }
    static HttpResponse<String> request(String path, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(Duration.ofSeconds(15));
        if (body == null) request.GET();
        else {
            if (csrfToken == null) {
                HttpResponse<String> csrf = request("/api/security/csrf", null); requireSuccess(csrf);
                csrfToken = String.valueOf(object(parse(csrf.body())).get("csrfToken"));
            }
            request.header("X-CSRF-Token", csrfToken).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        }
        HttpResponse<String> result = HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        result.headers().firstValue("X-CSRF-Token").ifPresent(t -> csrfToken = t);
        return result;
    }
    static void requireSuccess(HttpResponse<String> response) throws IOException {
        if (response.statusCode() / 100 != 2) {
            String message = response.body();
            try { message = String.valueOf(object(parse(message)).get("message")); } catch (Exception ignored) {}
            throw new IOException("HTTP " + response.statusCode() + ": " + message);
        }
    }
    static void login(String url) throws Exception {
        baseUrl = url.replaceAll("/+$", "");
        String email = System.getenv("SERUCHAT_EMAIL"), password = System.getenv("SERUCHAT_PASSWORD");
        Console console = System.console();
        if (email == null || password == null) {
            if (console != null) {
                email = console.readLine("Email: ");
                char[] secret = console.readPassword("Password: ");
                if (secret == null) throw new IOException("Login cancelled");
                password = new String(secret); Arrays.fill(secret, '\0');
            } else {
                BufferedReader input = INPUT;
                System.out.print("Email: "); email = input.readLine();
                System.out.print("Password (visible in this terminal): "); password = input.readLine();
            }
        }
        if (email == null || password == null) throw new IOException("Email and password are required");
        HttpResponse<String> response = request("/api/auth/login", "{\"email\":" + quote(email) + ",\"password\":" + quote(password) + "}");
        requireSuccess(response);
        userId = String.valueOf(object(object(parse(response.body())).get("user")).get("id"));
        Path directory = Paths.get("keys"); Files.createDirectories(directory);
        seenFile = directory.resolve(userId + "-received.txt");
        if (Files.exists(seenFile)) seen.addAll(Files.readAllLines(seenFile, StandardCharsets.UTF_8));
    }
    static KeyPair receiverKeys() throws Exception { return SecurityV2.keys(); }
    static String nextInbox() throws Exception {
        HttpResponse<String> response = request("/messages/" + userId, null);
        if (response.statusCode() == 204) return null;
        requireSuccess(response);
        for (Object item : array(parse(response.body()))) {
            Map<String, Object> message = object(item);
            String id = String.valueOf(message.get("id"));
            if (seen.add(id)) {
                if (!message.containsKey("iv")) message.put("iv", message.get("nonce"));
                if (!message.containsKey("senderPublicKey")) message.put("senderPublicKey", message.get("sender_public_key"));
                return json(message);
            }
        }
        return null;
    }
    static void acknowledge(String json) throws Exception {
        String id = String.valueOf(object(parse(json)).get("id"));
        Files.writeString(seenFile, id + System.lineSeparator(), StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }
    static String json(Map<String, Object> object) {
        StringJoiner out = new StringJoiner(",", "{", "}");
        object.forEach((k,v) -> out.add(quote(k) + ":" + (v == null ? "null" : v instanceof Number || v instanceof Boolean ? v.toString() : quote(v.toString()))));
        return out.toString();
    }
    @SuppressWarnings("unchecked") static Map<String, Object> object(Object value) throws IOException {
        if (!(value instanceof Map)) throw new IOException("Expected a JSON object");
        return (Map<String, Object>)value;
    }
    @SuppressWarnings("unchecked") static List<Object> array(Object value) throws IOException {
        if (!(value instanceof List)) throw new IOException("Expected a JSON array");
        return (List<Object>)value;
    }
    static Object parse(String value) throws IOException {
        Json parser = new Json(value); Object result = parser.value(); parser.space();
        if (parser.index != value.length()) throw new IOException("Trailing JSON data");
        return result;
    }
    private static final class Json {
        final String source; int index;
        Json(String source) { this.source = source; }
        void space() { while (index < source.length() && Character.isWhitespace(source.charAt(index))) index++; }
        char take() throws IOException { if (index >= source.length()) throw new IOException("Incomplete JSON"); return source.charAt(index++); }
        void expect(char c) throws IOException { space(); if (take() != c) throw new IOException("Invalid JSON"); }
        Object value() throws IOException {
            space(); if (index >= source.length()) throw new IOException("Empty JSON"); char c = source.charAt(index);
            if (c == '"') return string();
            if (c == '{') {
                index++; Map<String, Object> result = new LinkedHashMap<>(); space();
                if (index < source.length() && source.charAt(index) == '}') { index++; return result; }
                while (true) { space(); String key = string(); expect(':'); result.put(key, value()); space(); char end = take(); if (end == '}') return result; if (end != ',') throw new IOException("Invalid JSON object"); }
            }
            if (c == '[') {
                index++; List<Object> result = new ArrayList<>(); space();
                if (index < source.length() && source.charAt(index) == ']') { index++; return result; }
                while (true) { result.add(value()); space(); char end = take(); if (end == ']') return result; if (end != ',') throw new IOException("Invalid JSON array"); }
            }
            for (String literal : new String[]{"true", "false", "null"}) if (source.startsWith(literal, index)) { index += literal.length(); return literal.equals("null") ? null : Boolean.valueOf(literal); }
            int start = index; while (index < source.length() && "-+0123456789.eE".indexOf(source.charAt(index)) >= 0) index++;
            if (start == index) throw new IOException("Invalid JSON value"); return source.substring(start, index);
        }
        String string() throws IOException {
            expect('"'); StringBuilder result = new StringBuilder();
            while (true) {
                char c = take(); if (c == '"') return result.toString();
                if (c < 32) throw new IOException("Invalid control character");
                if (c != '\\') { result.append(c); continue; }
                c = take();
                switch (c) {
                    case '"': case '\\': case '/': result.append(c); break;
                    case 'b': result.append('\b'); break; case 'f': result.append('\f'); break;
                    case 'n': result.append('\n'); break; case 'r': result.append('\r'); break; case 't': result.append('\t'); break;
                    case 'u':
                        if (index + 4 > source.length()) throw new IOException("Invalid Unicode escape");
                        try { result.append((char)Integer.parseInt(source.substring(index, index + 4), 16)); }
                        catch (NumberFormatException e) { throw new IOException("Invalid Unicode escape", e); }
                        index += 4; break;
                    default: throw new IOException("Invalid JSON escape");
                }
            }
        }
    }
}
