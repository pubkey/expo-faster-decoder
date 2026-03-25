// Copyright 2015-present 650 Industries. All rights reserved.

package expo.modules.textdecoder

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.CodingErrorAction
import java.nio.charset.CharsetDecoder
import java.nio.ByteBuffer

/**
 * Native module providing high-performance UTF-8 decoding using JVM's
 * optimized Charset decoder.
 *
 * This is significantly faster than the JavaScript byte-by-byte state machine
 * for large Uint8Arrays because the JVM uses optimized native routines
 * for UTF-8 validation and transcoding.
 */
@Suppress("unused")
class ExpoTextDecoderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoTextDecoderModule")

    /**
     * Decode a Uint8Array of UTF-8 bytes into a String.
     *
     * @param data The raw UTF-8 bytes to decode (received as ByteArray from JS Uint8Array).
     * @param fatal If true, throws on invalid UTF-8 sequences.
     *              If false, invalid sequences are replaced with U+FFFD.
     * @return The decoded string.
     */
    Function("decodeUTF8") { data: ByteArray, fatal: Boolean ->
      val decoder: CharsetDecoder = Charsets.UTF_8.newDecoder()
      if (fatal) {
        decoder.onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
        try {
          return@Function decoder.decode(ByteBuffer.wrap(data)).toString()
        } catch (e: java.nio.charset.MalformedInputException) {
          throw InvalidUTF8Exception()
        }
      } else {
        decoder.onMalformedInput(CodingErrorAction.REPLACE)
          .onUnmappableCharacter(CodingErrorAction.REPLACE)
          .replaceWith("\uFFFD")
        return@Function decoder.decode(ByteBuffer.wrap(data)).toString()
      }
    }
  }
}

private class InvalidUTF8Exception :
  CodedException("ERR_INVALID_UTF8", "The encoded data was not valid for encoding utf-8", null)
