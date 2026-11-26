package `in`.partpoint.core.network

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

private class FakeTokens(var token: String?, private val next: String?) : TokenProvider {
    var refreshes = 0
    override fun accessToken() = token
    override fun refreshBlocking(failedToken: String?): String? { refreshes++; token = next; return next }
}

class TokenAuthenticatorTest {
    private val server = MockWebServer().apply { start() }
    @After fun tearDown() = server.close()

    private fun client(t: TokenProvider) = OkHttpClient.Builder().addInterceptor(AuthInterceptor(t)).authenticator(TokenAuthenticator(t)).build()
    private fun get(c: OkHttpClient, noAuth: Boolean = false) = c.newCall(
        Request.Builder().url(server.url("/v1/me")).apply { if (noAuth) header(AuthInterceptor.NO_AUTH, "1") }.build(),
    ).execute().use { it.code }

    @Test fun `retries once with a fresh token after a 401`() {
        val t = FakeTokens("old", "new")
        server.enqueue(MockResponse(401))
        server.enqueue(MockResponse(200, body = "{}"))
        assertEquals(200, get(client(t)))
        assertEquals("Bearer old", server.takeRequest().headers["Authorization"])
        assertEquals("Bearer new", server.takeRequest().headers["Authorization"])
    }

    @Test fun `gives up after one retry so it can never loop`() {
        val t = FakeTokens("old", "new")
        repeat(3) { server.enqueue(MockResponse(401)) }
        assertEquals(401, get(client(t)))
        assertEquals(1, t.refreshes)
    }

    @Test fun `sign-in calls go out without a token`() {
        server.enqueue(MockResponse(200, body = "{}"))
        get(client(FakeTokens("old", null)), noAuth = true)
        val sent = server.takeRequest()
        assertEquals(null, sent.headers["Authorization"])
        assertEquals(null, sent.headers[AuthInterceptor.NO_AUTH])
    }
}
