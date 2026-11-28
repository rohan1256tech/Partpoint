package `in`.partpoint.core.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneNumberTest {
    @Test fun `accepts the common ways people type a mobile number`() {
        for (input in listOf("9876543210", "09876543210", "919876543210", "+91 98765-43210", "+919876543210")) {
            assertEquals(input, "+919876543210", PhoneNumber.normalize(input))
        }
    }

    @Test fun `rejects numbers that are not Indian mobiles`() {
        for (input in listOf("", "12345", "5876543210", "98765432101", "+14155550123")) {
            assertNull(input, PhoneNumber.normalize(input))
        }
    }

    @Test fun `formats for display`() = assertEquals("98765 43210", PhoneNumber.display("+919876543210"))
}
