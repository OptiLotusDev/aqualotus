use crate::ir::Function;
use crate::sink::PrintSink;
use crate::value::Value;

use crate::package::registry::Package;
use crate::package::registry::PACKAGE_NAME;

impl Package {
    pub fn run_main(
        &self,
        sink: &mut impl PrintSink,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        self.run_main_with_limit(sink, crate::exec::MAX_STEPS)
    }

    /// Same as [`Package::run_main`] with an explicit step cap.
    pub fn run_main_with_limit(
        &self,
        sink: &mut impl PrintSink,
        max_steps: usize,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        let mut source = crate::sink::VecSource::default();
        crate::exec::run_program_with_limit(&self.as_program(), sink, &mut source, max_steps)
    }

    /// Same as [`Package::run_main`] but reads from the supplied input source.
    pub fn run_main_with_input(
        &self,
        sink: &mut impl PrintSink,
        input: &mut impl crate::sink::InputSource,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        self.run_main_with_input_with_limit(sink, input, crate::exec::MAX_STEPS)
    }

    /// Same as [`Package::run_main_with_limit`] but reads from the supplied input source.
    pub fn run_main_with_input_with_limit(
        &self,
        sink: &mut impl PrintSink,
        input: &mut impl crate::sink::InputSource,
        max_steps: usize,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        crate::exec::run_program_with_limit(&self.as_program(), sink, input, max_steps)
    }

    /// Run `main` reading successive lines from `lines`.
    pub fn run_main_with_input_lines(
        &self,
        sink: &mut impl PrintSink,
        lines: Vec<String>,
    ) -> Result<crate::exec::ExecReport, crate::error::ExecError> {
        let mut source = crate::sink::VecSource {
            lines,
            ..crate::sink::VecSource::default()
        };
        crate::exec::run_program_with_limit(
            &self.as_program(),
            sink,
            &mut source,
            crate::exec::MAX_STEPS,
        )
    }

    /// Same as [`Package::run_main`] but also captures `main`'s `Return`.
    pub fn run_main_returning(
        &self,
        sink: &mut impl PrintSink,
    ) -> Result<(crate::exec::ExecReport, Option<Value>), crate::error::ExecError> {
        let mut source = crate::sink::VecSource::default();
        crate::exec::run_program_returning_with_limit(
            &self.as_program(),
            sink,
            &mut source,
            crate::exec::MAX_STEPS,
        )
    }

    /// Snapshot the registry as a `Program` for the call-aware executor.
    pub fn as_program(&self) -> crate::ir::Program {
        let mut functions: Vec<Function> = self.functions.values().cloned().collect();
        functions.sort_by_key(|f| f.id.0);
        crate::ir::Program {
            version: 1,
            package: PACKAGE_NAME.to_string(),
            functions,
        }
    }
}
