// Copyright 2015-present 650 Industries. All rights reserved.

import ExpoModulesCore

/**
 * Native module providing high-performance UTF-8 decoding using Foundation's
 * optimized String(decoding:as:) and String(data:encoding:) APIs.
 *
 * This is significantly faster than the JavaScript byte-by-byte state machine
 * for large Uint8Arrays because Foundation uses SIMD-optimized ICU routines
 * for UTF-8 validation and transcoding.
 */
public final class ExpoTextDecoderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoTextDecoderModule")

    /// Decode a Uint8Array of UTF-8 bytes into a String.
    ///
    /// - Parameters:
    ///   - data: The raw UTF-8 bytes to decode (received as Data from JS Uint8Array).
    ///   - fatal: If true, throws on invalid UTF-8 sequences.
    ///            If false, invalid sequences are replaced with U+FFFD.
    /// - Returns: The decoded string.
    Function("decodeUTF8") { (data: Data, fatal: Bool) -> String in
      if fatal {
        // String(data:encoding:) returns nil for invalid UTF-8
        guard let text = String(data: data, encoding: .utf8) else {
          throw InvalidUTF8Exception()
        }
        return text
      }
      // String(decoding:as:) replaces invalid sequences with U+FFFD (replacement character)
      return String(decoding: data, as: UTF8.self)
    }
  }
}

private final class InvalidUTF8Exception: Exception {
  override var reason: String {
    "The encoded data was not valid for encoding utf-8"
  }
}
