import Foundation
import ExpoModulesCore

@available(iOS 14, tvOS 14, *)
internal final class FileSystemFileHandle: SharedRef<FileHandle> {
  let file: FileSystemFile
  let handle: FileHandle
  private var cachedFileSize: UInt64

  init(file: FileSystemFile, mode: String? = nil) throws {
    self.file = file
    switch mode {
    case "r":
      handle = try FileHandle(forReadingFrom: file.url)
    case "w", "wa", "wt":
      handle = try FileHandle(forWritingTo: file.url)
    default:
      handle = try FileHandle(forUpdating: file.url)
    }

    // Cache the file size on open to avoid repeated seek-to-end operations.
    // This saves 3 syscalls per size access (offset, seekToEnd, seekBack).
    cachedFileSize = try handle.seekToEnd()
    handle.seek(toFileOffset: 0)

    if mode == "wt" {
      try handle.truncate(atOffset: 0)
      cachedFileSize = 0
    } else if mode == "wa" {
      handle.seek(toFileOffset: cachedFileSize)
    }

    super.init(handle)
  }

  func read(_ length: Int) throws -> Data {
    do {
      let data = try handle.read(upToCount: length)
      return data ?? Data()
    } catch {
      throw UnableToReadHandleException(error.localizedDescription)
    }
  }

  func readAt(_ offset: UInt64, _ length: Int) throws -> Data {
    handle.seek(toFileOffset: offset)
    return try read(length)
  }

  func write(_ bytes: Data) throws {
    let currentOffset = (try? handle.offset()) ?? 0
    try handle.write(contentsOf: bytes)
    let newOffset = currentOffset + UInt64(bytes.count)
    if newOffset > cachedFileSize {
      cachedFileSize = newOffset
    }
  }

  func writeAt(_ offset: UInt64, _ bytes: Data) throws {
    handle.seek(toFileOffset: offset)
    try write(bytes)
  }

  func close() throws {
    try handle.close()
  }

  var offset: UInt64? {
    get {
      try? handle.offset()
    }
    set(newOffset) {
      guard let newOffset else {
        return
      }
      handle.seek(toFileOffset: newOffset)
    }
  }

  var size: UInt64? {
    return cachedFileSize
  }
}
