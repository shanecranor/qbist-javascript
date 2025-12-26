import { createInfo, modifyInfo, type FormulaInfo } from './qbist.ts'

export class QbistState {
  formulas: FormulaInfo[] = new Array(9)
  mainFormula: FormulaInfo = createInfo()

  constructor() {
    this.generateFormulas()
  }

  generateFormulas() {
    this.formulas[0] = this.mainFormula
    for (let i = 1; i < 9; i++) {
      this.formulas[i] = modifyInfo(this.mainFormula)
    }
    console.log('[QbistState] generateFormulas:complete')
  }
}
