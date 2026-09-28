import ExpoModulesCore

public class TranscriptSelectionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TranscriptSelection")
    View(TranscriptSelectionView.self) {
      Events("onMeasure", "onLink")
      Prop("runs") { (view: TranscriptSelectionView, runs: [SelectionRun]) in
        view.runs = runs
      }
      Prop("unwrapped") { (view: TranscriptSelectionView, value: Bool) in
        view.unwrapped = value
      }
      OnViewDidUpdateProps { (view: TranscriptSelectionView) in
        view.updateText()
      }
    }
  }
}

struct SelectionRun: Record {
  @Field var text: String = ""
  @Field var color: Double = 4294967295
  @Field var background: Double? = nil
  @Field var fontSize: Double = 17
  @Field var lineHeight: Double = 26
  @Field var bold: Bool = false
  @Field var italic: Bool = false
  @Field var mono: Bool = false
  @Field var strike: Bool = false
  @Field var underline: Bool = false
  @Field var link: Bool = false
  @Field var alignment: String = "left"
}
