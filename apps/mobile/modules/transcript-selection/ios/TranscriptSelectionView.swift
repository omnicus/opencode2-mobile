import ExpoModulesCore
import UIKit

final class TranscriptSelectionView: ExpoView, UITextViewDelegate {
  let onMeasure = EventDispatcher()
  let onLink = EventDispatcher()
  var runs: [SelectionRun] = []
  var unwrapped = false
  private let textView = SelectionTextView()
  private var lastSize = CGSize.zero

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = false
    textView.backgroundColor = .clear
    textView.textContainerInset = .zero
    textView.textContainer.lineFragmentPadding = 0
    textView.dataDetectorTypes = []
    textView.linkTextAttributes = [:]
    textView.delegate = self
    addSubview(textView)
  }

  func updateText() {
    let attributed = NSMutableAttributedString(string: "")
    for (index, run) in runs.enumerated() {
      let size = CGFloat(run.fontSize)
      let weight: UIFont.Weight = run.bold ? .semibold : .regular
      var font = run.mono ? UIFont.monospacedSystemFont(ofSize: size, weight: weight)
                          : UIFont.systemFont(ofSize: size, weight: weight)
      if run.italic, let descriptor = font.fontDescriptor.withSymbolicTraits(font.fontDescriptor.symbolicTraits.union(.traitItalic)) {
        font = UIFont(descriptor: descriptor, size: size)
      }
      let paragraph = NSMutableParagraphStyle()
      paragraph.minimumLineHeight = CGFloat(run.lineHeight)
      paragraph.maximumLineHeight = CGFloat(run.lineHeight)
      paragraph.alignment = run.alignment == "right" ? .right : run.alignment == "center" ? .center : .natural
      var attributes: [NSAttributedString.Key: Any] = [
        .font: font, .foregroundColor: color(run.color), .paragraphStyle: paragraph
      ]
      if let background = run.background { attributes[.backgroundColor] = color(background) }
      if run.strike { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
      if run.underline { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
      if run.link { attributes[.link] = URL(string: "transcript-link://run/\(index)") }
      attributed.append(NSAttributedString(string: run.text, attributes: attributes))
    }
    // Unrelated React updates must not clear an active selection. Preserve its range
    // when streaming appends text; clamp only if the server shortens the content.
    if textView.attributedText?.isEqual(to: attributed) != true {
      let selected = textView.selectedRange
      textView.attributedText = attributed
      let location = min(selected.location, attributed.length)
      textView.selectedRange = NSRange(location: location, length: min(selected.length, attributed.length - location))
    }
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0 else { return }
    let width = unwrapped ? CGFloat(1_000_000) : bounds.width
    let fitted = textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    let size = CGSize(width: unwrapped ? ceil(fitted.width) : bounds.width, height: ceil(fitted.height))
    textView.frame = CGRect(origin: .zero, size: size)
    if size != lastSize {
      lastSize = size
      onMeasure(["width": size.width, "height": size.height])
    }
  }

  func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
    // Route taps through the existing confirmation handler. Never open links here.
    if interaction == .invokeDefaultAction, let index = Int(URL.lastPathComponent) {
      onLink(["index": index])
    }
    return false
  }

  private func color(_ value: Double) -> UIColor {
    let bits = UInt32(truncatingIfNeeded: Int64(value))
    return UIColor(red: CGFloat((bits >> 16) & 255) / 255,
                   green: CGFloat((bits >> 8) & 255) / 255,
                   blue: CGFloat(bits & 255) / 255,
                   alpha: CGFloat((bits >> 24) & 255) / 255)
  }
}

private final class SelectionTextView: UITextView {
  override func copy(_ sender: Any?) {
    let source = (text ?? "") as NSString
    let range = selectedRange
    guard range.location != NSNotFound, range.length > 0,
          range.location <= source.length, range.length <= source.length - range.location else { return }
    // Keep native range selection, but do not copy internal link-dispatch URLs.
    UIPasteboard.general.string = source.substring(with: range)
  }
}
