package io.github.serabin1.rssreader.core

import org.w3c.dom.Document
import org.w3c.dom.Element
import org.xml.sax.ErrorHandler
import org.xml.sax.InputSource
import org.xml.sax.SAXParseException
import java.io.ByteArrayInputStream
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

// DOM rather than a pull parser: it's in both the JDK and Android, so the
// parsers run under plain JVM unit tests, and it reads like the web app's
// DOMParser code it was ported from.
internal object Xml {
    fun parse(bytes: ByteArray): Document = parse(InputSource(ByteArrayInputStream(bytes)))

    fun parse(text: String): Document = parse(InputSource(StringReader(text)))

    private fun parse(source: InputSource): Document {
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            isExpandEntityReferences = false
        }
        val builder = factory.newDocumentBuilder()
        // Never fetch a DOCTYPE's external DTD: old RSS 0.91 feeds still point
        // at one, and resolving it would be a network request per parse (and
        // the classic XXE hole).
        builder.setEntityResolver { _, _ -> InputSource(StringReader("")) }
        // The default handler prints "[Fatal Error]" to stderr before throwing.
        builder.setErrorHandler(object : ErrorHandler {
            override fun warning(e: SAXParseException) = Unit
            override fun error(e: SAXParseException) = throw e
            override fun fatalError(e: SAXParseException) = throw e
        })
        return builder.parse(source)
    }

    fun Element.childElements(): Sequence<Element> = sequence {
        var node = firstChild
        while (node != null) {
            if (node is Element) yield(node)
            node = node.nextSibling
        }
    }

    // Direct children only, matched on local name and namespace — a bare
    // name would also match atom:link inside an RSS channel, or an item's own
    // <title> when the feed's is wanted.
    fun Element.child(localName: String, namespace: String? = null): Element? =
        childElements().firstOrNull { it.localName == localName && it.namespaceURI.orEmpty() == namespace.orEmpty() }

    fun Element.childText(localName: String, namespace: String? = null): String? =
        child(localName, namespace)?.textContent?.trim()?.ifEmpty { null }

    fun Element.attr(name: String): String? = if (hasAttribute(name)) getAttribute(name) else null
}
