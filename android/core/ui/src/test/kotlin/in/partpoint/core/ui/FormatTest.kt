package `in`.partpoint.core.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FormatTest {
    @Test fun `rupees use Indian grouping`() {
        assertEquals("₹1,23,456.50", rupees(12_345_650))
        assertEquals("₹1,23,456", rupees(12_345_600))
        assertEquals("₹1,23,456.00", rupees(12_345_600, alwaysDecimals = true))
        assertEquals("₹999", rupees(99_900))
        assertEquals("₹0", rupees(0))
        assertEquals("−₹50", rupees(-5_000))
        assertEquals("₹1,00,00,000", rupees(1_000_000_000))
    }

    @Test fun `times are shown in India time`() = assertEquals("27 Nov 2026, 1:30 AM", dateTime("2026-11-26T20:00:00Z"))

    @Test fun `discount against MRP`() {
        assertEquals(28, discountPercent(18_000, 12_800)) // 28.9% rounds down: never overstate a saving
        assertNull(discountPercent(10_000, 10_000))
        assertNull(discountPercent(null, 100))
    }

    @Test fun `status codes read as words`() = assertEquals("Out for delivery", humanize("out_for_delivery"))
}
