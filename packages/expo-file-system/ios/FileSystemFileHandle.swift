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
      handle.seek(toFileOffset: 0)
    } catch {
      cachedFileSize = 0
      handle.seek(toFileOffset: 0)
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

  func write(_ bytes: Data) throws {
    let currentOffset = (try? handle.offset()) ?? 0
    try handle.write(contentsOf: bytes)
    let newOffset = currentOffset + UInt64(bytes.count)
    if newOffset > cachedFileSize {
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
