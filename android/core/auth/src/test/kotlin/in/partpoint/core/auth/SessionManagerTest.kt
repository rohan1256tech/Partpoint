package `in`.partpoint.core.auth

import `in`.partpoint.core.network.ApiConfig
import `in`.partpoint.core.network.ClientApp
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

private class MemoryStore(var refresh: String?) : TokenStore {
    override fun refreshToken() = refresh
    override fun saveRefreshToken(token: String?) { refresh = token }
    override fun deviceId() = "android-test-device"
}

class SessionManagerTest {
    private val server = MockWebServer()
    private lateinit var store: MemoryStore
    private lateinit var session: SessionManager

    @Before fun setUp() {
        server.start()
        store = MemoryStore("rt-1")
        session = SessionManager(store, ApiConfig(server.url("/").toString(), ClientApp.PARTPOINT, "test"), OkHttpClient())
    }

    @After fun tearDown() = server.close()

    @Test fun `refresh stores the rotated refresh token and returns the new access token`() {
        server.enqueue(MockResponse(200, body = """{"accessToken":"at-2","refreshToken":"rt-2","expiresIn":900}"""))
        assertEquals("at-2", session.refreshBlocking(null))
        assertEquals("at-2", session.accessToken())
        assertEquals("rt-2", store.refresh)
        val sent = server.takeRequest()
        assertEquals("/v1/auth/token/refresh", sent.url.encodedPath)
        assertEquals("""{"refreshToken":"rt-1","deviceId":"android-test-device"}""", sent.body?.utf8())
    }

    @Test fun `a request that lost the race reuses the token another request already refreshed`() {
        server.enqueue(MockResponse(200, body = """{"accessToken":"at-2","refreshToken":"rt-2","expiresIn":900}"""))
        session.refreshBlocking("at-1")
        assertEquals("at-2", session.refreshBlocking("at-1")) // no second network call
        assertEquals(1, server.requestCount)
    }

    @Test fun `a rejected refresh ends the session`() {
        server.enqueue(MockResponse(401, body = """{"error":"Session expired","code":"INVALID_REFRESH_TOKEN"}"""))
        assertNull(session.refreshBlocking(null))
        assertNull(store.refresh)
        assert(session.session.value is Session.SignedOut)
    }

    @Test fun `an outage keeps the session`() {
        server.close()
        assertNull(session.refreshBlocking(null))
        assertEquals("rt-1", store.refresh)
    }
}
