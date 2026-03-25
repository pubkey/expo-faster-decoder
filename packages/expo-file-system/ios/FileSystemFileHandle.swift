import Foundation
import ExpoModulesCore

@available(iOS 14, tvOS 14, *)
internal final class FileSystemFileHandle: SharedRef<FileHandle> {
  let file: FileSystemFile
  let handle: FileHandle
  private var cachedFileSize: UInt64

  init(file: FileSystemFile) throws {
    self.file = file
    handle = try FileHandle(forUpdating: file.url)

    // Cache the file size on open to avoid repeated seek-to-end operations.
    // Each uncached size access required 3 syscalls: offset() → seekToEnd() → seek(back).
    do {
      cachedFileSize = try handle.seekToEnd()
    } catch {
      cachedFileSize = 0
    }
    handle.seek(toFileOffset: 0)

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

  func write(_ bytes: Data) throws {
    try handle.write(contentsOf: bytes)
    // Update cached size if the write extended the file.
    if let newOffset = try? handle.offset(), newOffset > cachedFileSize {
      cachedFileSize = newOffset
    }
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
