import javax.crypto.*;
import javax.crypto.spec.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;
import java.security.spec.*;
import java.util.*;

/** Versioned signed envelopes, recovery vault and manually verified public-key pins. */
public final class SecurityV2 {
    static KeyPair encryption, signing;
    static final SecureRandom RNG = new SecureRandom();
    static final String[] FIELDS = {"id", "conversationId", "senderId", "recipientId", "nonce", "ciphertext", "senderPublicKey", "selfNonce", "selfCiphertext", "selfPublicKey"};
    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
    static String b64(byte[] x) { return Base64.getEncoder().encodeToString(x); }
    static byte[] un64(String s) { return Base64.getDecoder().decode(s); }
    static String value(Map<String,Object> m, String k) throws IOException {
        Object v=m.get(k); if(v==null) throw new IOException("Missing field: "+k); return v.toString();
    }
    static byte[] random(int n) { byte[] b=new byte[n]; RNG.nextBytes(b); return b; }
    static String hex(byte[] b) { return HexFormat.of().formatHex(b); }
    static String readSecret(String prompt, String environment) throws IOException {
        String env=System.getenv(environment); if(env!=null) return env;
        if(System.console()!=null) { char[] c=System.console().readPassword("%s",prompt); if(c==null) throw new IOException("Cancelled"); String s=new String(c); Arrays.fill(c,'\0'); return s; }
        System.out.print(prompt+" (visible in this terminal): "); String s=ApiClient.INPUT.readLine(); if(s==null) throw new IOException("Cancelled"); return s;
    }
    static PublicKey pub(String name,String b) throws Exception { return KeyFactory.getInstance(name).generatePublic(new X509EncodedKeySpec(un64(b))); }
    static PrivateKey priv(String name,String b) throws Exception { return KeyFactory.getInstance(name).generatePrivate(new PKCS8EncodedKeySpec(un64(b))); }
    static byte[] hkdf(byte[] raw,byte[] salt,String info) throws Exception {
        Mac m=Mac.getInstance("HmacSHA256"); m.init(new SecretKeySpec(salt,"HmacSHA256")); byte[] prk=m.doFinal(raw);
        m.init(new SecretKeySpec(prk,"HmacSHA256")); m.update(utf8(info)); m.update((byte)1); byte[] result=m.doFinal(); Arrays.fill(prk,(byte)0); return result;
    }
    static byte[] vaultKey(String code,String salt) throws Exception {
        code=code.replaceAll("[\\s-]","").toLowerCase(Locale.ROOT);
        if(!code.matches("[a-f0-9]{64}")) throw new IOException("Recovery code needs 64 hex characters");
        byte[] raw=HexFormat.of().parseHex(code);
        try { return hkdf(raw,un64(salt),"seruchat-recovery-v2|"+ApiClient.userId); } finally { Arrays.fill(raw,(byte)0); }
    }
    static String bundleAad(Map<String,Object> b) throws Exception { return String.join("|","seruchat-key-bundle-v2",ApiClient.userId,value(b,"publicKey"),value(b,"signingPublicKey")); }
    static byte[] gcm(boolean encrypt,byte[] key,byte[] iv,byte[] data,String aad) throws Exception {
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding"); c.init(encrypt?Cipher.ENCRYPT_MODE:Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        c.updateAAD(utf8(aad)); return c.doFinal(data);
    }
    static String sign(String text) throws Exception { Signature s=Signature.getInstance("Ed25519"); s.initSign(signing.getPrivate()); s.update(utf8(text)); return b64(s.sign()); }
    static boolean verify(String text,String signature,String publicKey) throws Exception { Signature s=Signature.getInstance("Ed25519"); s.initVerify(pub("Ed25519",publicKey)); s.update(utf8(text)); return s.verify(un64(signature)); }
    static Map<String,Object> remote(String id) throws Exception {
        var r=ApiClient.request("/api/keys/public/"+id,null); ApiClient.requireSuccess(r); return ApiClient.object(ApiClient.parse(r.body()));
    }
    static void writeVault(Path file,Map<String,Object> data) throws Exception {
        Files.createDirectories(file.getParent()); Path temp=Files.createTempFile(file.getParent(),"vault-",".tmp");
        try { Files.writeString(temp,ApiClient.json(data),StandardCharsets.UTF_8);
            try { Files.setPosixFilePermissions(temp,PosixFilePermissions.fromString("rw-------")); } catch(UnsupportedOperationException ignored) {}
            Files.move(temp,file,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        } finally { Files.deleteIfExists(temp); }
    }
    static void openVault(Map<String,Object> b,String code) throws Exception {
        byte[] key=vaultKey(code,value(b,"salt")),raw;
        try { raw=gcm(false,key,un64(value(b,"iv")),un64(value(b,"encryptedPrivateKey")),bundleAad(b)); } finally { Arrays.fill(key,(byte)0); }
        Map<String,Object> bundle;
        try { bundle=ApiClient.object(ApiClient.parse(new String(raw,StandardCharsets.UTF_8))); } finally { Arrays.fill(raw,(byte)0); }
        encryption=new KeyPair(pub("X25519",value(b,"publicKey")),priv("X25519",value(bundle,"x")));
        signing=new KeyPair(pub("Ed25519",value(b,"signingPublicKey")),priv("Ed25519",value(bundle,"s")));
        KeyPair ep=Sender.generateKeyPair();
        if(!MessageDigest.isEqual(Sender.x25519(encryption.getPrivate(),ep.getPublic()),Sender.x25519(ep.getPrivate(),encryption.getPublic())) ||
            !verify("restore-check",sign("restore-check"),value(b,"signingPublicKey"))) throw new IOException("Restored keys do not match");
    }
    static KeyPair keys() throws Exception {
        if(encryption!=null) return encryption;
        Path directory=Paths.get("keys",ApiClient.userId), file=directory.resolve("vault-v2.json");
        var r=ApiClient.request("/api/keys/public/"+ApiClient.userId,null);
        if(r.statusCode()!=404) ApiClient.requireSuccess(r);
        Map<String,Object> remote=r.statusCode()==404?null:ApiClient.object(ApiClient.parse(r.body()));
        Map<String,Object> vault=null;
        if(Files.exists(file)) vault=ApiClient.object(ApiClient.parse(Files.readString(file)));
        else if(remote!=null && "2".equals(remote.get("backupVersion").toString())) {
            var backup=ApiClient.request("/api/keys/private",null); ApiClient.requireSuccess(backup);
            vault=new LinkedHashMap<>(ApiClient.object(ApiClient.parse(backup.body()))); vault.putAll(remote);
        }
        if(vault!=null) {
            if(remote!=null && (!value(vault,"publicKey").equals(value(remote,"publicKey")) || remote.get("signingPublicKey")!=null && !value(vault,"signingPublicKey").equals(value(remote,"signingPublicKey")))) throw new IOException("Server/local keys differ; refusing replacement");
            openVault(vault,readSecret("Recovery code: ","SERUCHAT_RECOVERY"));
            if(!Files.exists(file)) writeVault(file,vault);
            if(remote==null || remote.get("signingPublicKey")==null) { vault.put("backupVersion",2); vault.put("keyProof",sign(String.join("|","seruchat-key-v2",ApiClient.userId,value(vault,"publicKey"),value(vault,"signingPublicKey"),value(vault,"encryptedPrivateKey"),value(vault,"salt"),value(vault,"iv")))); ApiClient.requireSuccess(ApiClient.request("/api/keys/public",ApiClient.json(vault))); }
            Path oldPriv=directory.resolve("private.pkcs8"),oldPub=directory.resolve("public.spki");
            if(Files.exists(oldPriv)&&Files.exists(oldPub) && MessageDigest.isEqual(Files.readAllBytes(oldPub),encryption.getPublic().getEncoded()) && MessageDigest.isEqual(Files.readAllBytes(oldPriv),encryption.getPrivate().getEncoded())) {
                Files.delete(oldPriv); Files.delete(oldPub);
            }
            return encryption;
        }
        Path oldPrivate=directory.resolve("private.pkcs8"), oldPublic=directory.resolve("public.spki");
        if(Files.exists(oldPrivate)&&Files.exists(oldPublic)) {
            encryption=new KeyPair(pub("X25519",b64(Files.readAllBytes(oldPublic))),priv("X25519",b64(Files.readAllBytes(oldPrivate))));
            if(remote!=null&&!Sender.exportPublicKey(encryption.getPublic()).equals(value(remote,"publicKey"))) throw new IOException("Original Java keys do not match the server");
        } else {
            if(remote!=null) throw new IOException("Legacy key exists elsewhere. Upgrade using the original web/Java device first.");
            encryption=Sender.generateKeyPair();
        }
        signing=KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
        String code=System.getenv("SERUCHAT_RECOVERY");
        if(code==null) {
            code=hex(random(32)); System.out.println("SAVE YOUR PRIVATE RECOVERY CODE: "+code);
            System.out.print("Saved privately? Type yes to continue: ");
            if(!"yes".equalsIgnoreCase(ApiClient.INPUT.readLine())) throw new IOException("Cancelled before publish");
        }
        Map<String,Object> b=new LinkedHashMap<>(); b.put("publicKey",Sender.exportPublicKey(encryption.getPublic())); b.put("signingPublicKey",Sender.exportPublicKey(signing.getPublic()));
        b.put("backupVersion",2); b.put("algorithm","X25519"); b.put("salt",b64(random(16))); b.put("iv",b64(random(12)));
        Map<String,Object> raw=new LinkedHashMap<>(); raw.put("x",b64(encryption.getPrivate().getEncoded())); raw.put("s",b64(signing.getPrivate().getEncoded()));
        byte[] key=vaultKey(code,value(b,"salt")), plain=utf8(ApiClient.json(raw));
        try { b.put("encryptedPrivateKey",b64(gcm(true,key,un64(value(b,"iv")),plain,bundleAad(b)))); } finally { Arrays.fill(key,(byte)0); Arrays.fill(plain,(byte)0); }
        b.put("keyProof",sign(String.join("|","seruchat-key-v2",ApiClient.userId,value(b,"publicKey"),value(b,"signingPublicKey"),value(b,"encryptedPrivateKey"),value(b,"salt"),value(b,"iv"))));
        writeVault(file,b); // No plaintext key files are created. Retry opens this same vault.
        ApiClient.requireSuccess(ApiClient.request("/api/keys/public",ApiClient.json(b)));
        Files.deleteIfExists(oldPrivate); Files.deleteIfExists(oldPublic); // Only after encrypted vault and server publish succeed.
        System.out.println("Fingerprint: "+fingerprint(ApiClient.userId,b));
        return encryption;
    }
    static String fingerprint(String id,Map<String,Object> b) throws Exception {
        String hex=hex(MessageDigest.getInstance("SHA-256").digest(utf8(String.join("|","seruchat-fingerprint-v2",id,value(b,"publicKey"),value(b,"signingPublicKey")))));
        return String.join(" ",hex.split("(?<=\\G.{8})"));
    }
    static Path trustFile() throws Exception { return Paths.get("keys",ApiClient.userId,"trust-"+hex(MessageDigest.getInstance("SHA-256").digest(utf8(ApiClient.baseUrl))).substring(0,12)+".properties"); }
    static Properties pins() throws Exception { Properties p=new Properties(); if(Files.exists(trustFile())) try(var in=Files.newInputStream(trustFile())) { p.load(in); } return p; }
    static void verifyPeer(String id) throws Exception {
        Map<String,Object> b=remote(id); String fp=fingerprint(id,b);
        System.out.println("Server key fingerprint (must compare with the peer): "+fp);
        System.out.print("Paste fingerprint received directly from the peer: "); String entered=ApiClient.INPUT.readLine();
        if(entered==null||!entered.replaceAll("\\s","").equalsIgnoreCase(fp.replace(" ",""))) throw new IOException("Fingerprint mismatch");
        System.out.print("Compared via a trusted channel? Type yes: "); if(!"yes".equalsIgnoreCase(ApiClient.INPUT.readLine())) throw new IOException("Cancelled");
        Properties p=pins(); p.setProperty(id,fp); Files.createDirectories(trustFile().getParent()); try(var out=Files.newOutputStream(trustFile())) { p.store(out,"Verified Seruchat fingerprints"); }
        System.out.println("Peer verified on this device.");
    }
    static Map<String,Object> trusted(String id) throws Exception {
        Map<String,Object> b=remote(id); if(!fingerprint(id,b).equals(pins().getProperty(id))) throw new IOException("Peer key is unverified or changed. Run: java ApiClient verify "+id); return b;
    }
    static String aad(Map<String,Object> e,String role) throws Exception { return String.join("|","seruchat-aad-v2",value(e,"id"),value(e,"conversationId"),value(e,"senderId"),value(e,"recipientId"),role); }
    static String signed(Map<String,Object> e) throws Exception { StringJoiner j=new StringJoiner("|"); j.add("seruchat-signature-v2"); for(String f:FIELDS) j.add(value(e,f)); return j.toString(); }
    static void encrypt(Map<String,Object> e,String message,String recipientKey,boolean self) throws Exception {
        KeyPair ep=Sender.generateKeyPair(); byte[] key=Sender.deriveKey(ep.getPrivate(),recipientKey),iv=random(12);
        byte[] ciphertext; try { ciphertext=gcm(true,key,iv,utf8(message),aad(e,self?"self":"recipient")); } finally { Arrays.fill(key,(byte)0); }
        e.put(self?"selfNonce":"nonce",b64(iv)); e.put(self?"selfCiphertext":"ciphertext",b64(ciphertext)); e.put(self?"selfPublicKey":"senderPublicKey",Sender.exportPublicKey(ep.getPublic()));
    }
    static void send(String peer,String text) throws Exception {
        keys(); Map<String,Object> target=trusted(peer);
        var c=ApiClient.request("/api/conversations","{\"friendId\":"+ApiClient.quote(peer)+"}"); ApiClient.requireSuccess(c);
        String conversation=value(ApiClient.object(ApiClient.parse(c.body())),"conversationId");
        Map<String,Object> e=new LinkedHashMap<>(); e.put("version",2); e.put("id",UUID.randomUUID().toString()); e.put("conversationId",conversation); e.put("senderId",ApiClient.userId); e.put("recipientId",peer);
        encrypt(e,text,value(target,"publicKey"),false); encrypt(e,text,Sender.exportPublicKey(encryption.getPublic()),true); e.put("signature",sign(signed(e)));
        ApiClient.requireSuccess(ApiClient.request("/api/messages",ApiClient.json(e)));
    }
    static String decrypt(PrivateKey key,String json) throws Exception {
        Map<String,Object> row=ApiClient.object(ApiClient.parse(json));
        if(!"2".equals(row.get("protocol_version").toString())) return "[Legacy v1: no signature/AAD] "+Receiver.receiveMessage(key,json);
        Map<String,Object> e=new LinkedHashMap<>();
        String[] db={"id","conversation_id","sender_id","recipient_id","nonce","ciphertext","sender_public_key","self_nonce","self_ciphertext","self_public_key"};
        for(int i=0;i<FIELDS.length;i++) e.put(FIELDS[i],row.get(db[i]));
        if(!ApiClient.userId.equals(value(e,"recipientId"))) throw new IOException("Wrong recipient");
        Map<String,Object> sender=trusted(value(e,"senderId"));
        if(!value(sender,"signingPublicKey").equals(value(row,"sender_signing_key")) || !verify(signed(e),value(row,"signature"),value(sender,"signingPublicKey"))) throw new IOException("Invalid sender signature");
        byte[] aes=Sender.deriveKey(key,value(e,"senderPublicKey"));
        try { return new String(gcm(false,aes,un64(value(e,"nonce")),un64(value(e,"ciphertext")),aad(e,"recipient")),StandardCharsets.UTF_8); }
        finally { Arrays.fill(aes,(byte)0); }
    }
}
