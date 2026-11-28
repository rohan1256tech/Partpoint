package `in`.partpoint.app.sell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StockTest {
    @Test fun `typed rupees become paise`() {
        assertEquals(165000L, textToPaise("1650"))
        assertEquals(165050L, textToPaise("1650.5"))
        assertEquals(165005L, textToPaise("1650.05"))
        assertEquals(100L, textToPaise("1."))
        assertNull(textToPaise(""))
        assertNull(textToPaise("12.345"))
        assertNull(textToPaise("1.2.3"))
    }

    @Test fun `paise are shown without needless decimals`() {
        assertEquals("1650", paiseToText(165000))
        assertEquals("1650.50", paiseToText(165050))
    }
}
