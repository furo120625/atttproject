import javax.crypto.Cipher;

import javax.crypto.KeyAgreement;

import javax.crypto.Mac;

import javax.crypto.spec.GCMParameterSpec;

import javax.crypto.spec.SecretKeySpec;



import java.net.URI;

import java.net.URLEncoder;

import java.net.http.HttpClient;

import java.net.http.HttpRequest;

import java.net.http.HttpResponse;



import java.nio.charset.StandardCharsets;



import java.security.GeneralSecurityException;

import java.security.KeyFactory;

import java.security.KeyPair;

import java.security.KeyPairGenerator;

import java.security.PrivateKey;

import java.security.PublicKey;



import java.security.spec.X509EncodedKeySpec;



import java.util.Base64;



import java.util.regex.Matcher;

import java.util.regex.Pattern;





public class Receiver {



    private static final String HKDF_INFO =

        "e2ee-chat-v1";



    private static final int TAG_BITS =

        128;



    private static final HttpClient HTTP =

        ApiClient.HTTP;





    // ==============================================================

    // X25519

    // ==============================================================



    static byte[] x25519(

        PrivateKey myPrivate,

        PublicKey senderPublic

    ) throws GeneralSecurityException {



        KeyAgreement ka =

            KeyAgreement.getInstance(

                "X25519"

            );



        ka.init(

            myPrivate

        );



        ka.doPhase(

            senderPublic,

            true

        );



        return ka.generateSecret();

    }





    // ==============================================================

    // HKDF-SHA256

    // ==============================================================



    static byte[] hkdf(

        byte[] sharedSecret

    ) throws GeneralSecurityException {



        Mac mac =

            Mac.getInstance(

                "HmacSHA256"

            );





        // HKDF Extract

        mac.init(

            new SecretKeySpec(

                new byte[32],

                "HmacSHA256"

            )

        );



        byte[] prk =

            mac.doFinal(

                sharedSecret

            );





        // HKDF Expand

        mac.init(

            new SecretKeySpec(

                prk,

                "HmacSHA256"

            )

        );



        mac.update(

            HKDF_INFO.getBytes(

                StandardCharsets.UTF_8

            )

        );



        mac.update(

            (byte) 1

        );



        return mac.doFinal();

    }





    // ==============================================================

    // AES-256-GCM DECRYPT

    // ==============================================================



    static String aesGcmDecrypt(

        byte[] aesKey,

        byte[] iv,

        byte[] ciphertext

    ) throws GeneralSecurityException {



        Cipher cipher =

            Cipher.getInstance(

                "AES/GCM/NoPadding"

            );





        GCMParameterSpec spec =

            new GCMParameterSpec(

                TAG_BITS,

                iv

            );





        cipher.init(

            Cipher.DECRYPT_MODE,

            new SecretKeySpec(

                aesKey,

                "AES"

            ),

            spec

        );





        byte[] plaintext =

            cipher.doFinal(

                ciphertext

            );





        return new String(

            plaintext,

            StandardCharsets.UTF_8

        );

    }





    // ==============================================================

    // RECEIVE + DECRYPT JSON

    // ==============================================================



    public static String receiveMessage(

        PrivateKey myPrivateKey,

        String jsonPayload

    ) throws Exception {



        String ivB64 =

            extractJsonField(

                jsonPayload,

                "iv"

            );





        String ciphertextB64 =

            extractJsonField(

                jsonPayload,

                "ciphertext"

            );





        String senderPublicKeyB64 =

            extractJsonField(

                jsonPayload,

                "senderPublicKey"

            );





        byte[] iv =

            Base64

                .getDecoder()

                .decode(ivB64);





        byte[] ciphertext =

            Base64

                .getDecoder()

                .decode(ciphertextB64);





        byte[] senderPublicKeyBytes =

            Base64

                .getDecoder()

                .decode(senderPublicKeyB64);





        KeyFactory kf =

            KeyFactory.getInstance(

                "X25519"

            );





        PublicKey senderPublicKey =

            kf.generatePublic(

                new X509EncodedKeySpec(

                    senderPublicKeyBytes

                )

            );





        byte[] sharedSecret =

            x25519(

                myPrivateKey,

                senderPublicKey

            );





        byte[] aesKey =

            hkdf(

                sharedSecret

            );





        return aesGcmDecrypt(

            aesKey,

            iv,

            ciphertext

        );

    }





    // ==============================================================

    // GUI PUBLIC KEY CUA RECEIVER LEN SERVER

    // ==============================================================



    static void registerPublicKey(

        String serverUrl,

        String username,

        PublicKey publicKey

    ) throws Exception {



        String encodedUsername =

            URLEncoder.encode(

                username,

                StandardCharsets.UTF_8

            );





        String publicKeyB64 =

            Base64

                .getEncoder()

                .encodeToString(

                    publicKey.getEncoded()

                );





        String json =

            "{\"publicKey\":\""

            + publicKeyB64

            + "\"}";





        HttpRequest request =

            HttpRequest

                .newBuilder(

                    URI.create(

                        serverUrl

                        + "/users/"

                        + encodedUsername

                        + "/public-key"

                    )

                )

                .header(

                    "Content-Type",

                    "application/json"

                )

                .POST(

                    HttpRequest.BodyPublishers.ofString(

                        json

                    )

                )

                .build();





        HttpResponse<String> response =

            HTTP.send(

                request,

                HttpResponse.BodyHandlers.ofString()

            );





        if (

            response.statusCode() / 100 != 2

        ) {



            throw new Exception(

                "Khong dang ky duoc PublicKey. HTTP "

                + response.statusCode()

            );

        }

    }





    // ==============================================================

    // HOI SERVER CO MESSAGE MOI KHONG

    // ==============================================================



    static String getMessage(String serverUrl, String username) throws Exception {
        return ApiClient.nextInbox();
    }

    // ==============================================================

    // JSON HELPER

    // ==============================================================



    private static String extractJsonField(

        String json,

        String field

    ) throws Exception {



        Matcher matcher =

            Pattern.compile(

                "\""

                + field

                + "\"\\s*:\\s*\"([^\"]+)\""

            )

            .matcher(json);





        if (

            matcher.find()

        ) {

            return matcher.group(1);

        }





        throw new Exception(

            "Khong tim thay truong '"

            + field

            + "'"

        );

    }





    // ==============================================================

    // MAIN

    // ==============================================================



    public static void main(String[] args) throws Exception {
        String serverUrl = args.length > 0 ? args[0] : "http://localhost:3000";
        ApiClient.login(serverUrl);
        String username = ApiClient.userId;
        KeyPair myKeyPair = ApiClient.receiverKeys();
        System.out.println("RECEIVER User ID: " + username);
        // SecurityV2.keys() publishes the signed recovery bundle.
        System.out.println("Public key registered. Waiting for encrypted messages...");
        while (true) {
            String json;
            try { json = getMessage(serverUrl, username); }
            catch (Exception e) {
                System.err.println(e.getMessage());
                if (e.getMessage() != null && e.getMessage().contains("HTTP 401")) break;
                Thread.sleep(2000); continue;
            }
            if (json == null) { Thread.sleep(1000); continue; }
            System.out.println("[RECEIVER] ENCRYPTED JSON: " + json);
            try {
                String plaintext = SecurityV2.decrypt(myKeyPair.getPrivate(), json);
                System.out.println("[RECEIVER] DECRYPTED: " + plaintext);
                ApiClient.acknowledge(json);
            } catch (Exception e) {
                System.err.println("[RECEIVER] DECRYPT FAILED: " + e.getMessage());
            }
        }
    }
}
