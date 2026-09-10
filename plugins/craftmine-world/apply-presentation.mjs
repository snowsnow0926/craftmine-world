// Presentation only: the host's existing apply transaction remains authoritative.
export function applyPresentation({busy=false,closing=false,preview=null,review=null,reviewLoading=false,reviewError=null,attempt=null,applyError=null}={}) {
  const primaryDisabled=busy||closing||(!!attempt&&!attempt.godot)||!preview||(!preview.godot&&(!review?.current||review.status!=='completed'||!review.acceptance?.passed));
  const warningHidden=review?.status!=='completed'||review.acceptance?.passed!==false;
  const warningDisabled=busy||closing||!!attempt||!preview||!review?.current||warningHidden;
  const result={primaryDisabled,warningHidden,warningDisabled,code:'ready',reason:'检查已通过，可以应用这份预览。',next:'应用时仍会核对当前草稿和最新游玩进度。'};
  const explain=(code,reason,next)=>Object.assign(result,{code,reason,next});
  if(closing)return explain('closing','正在退出当前世界，暂不能应用。','请等待保存和退出完成。');
  if(attempt)return explain('confirming','正在确认上一次应用的结果。','原世界保持暂停；将查询原操作回执，请勿再次创建应用。');
  if(busy)return explain('busy','正在处理世界操作，暂不能应用。','请等待当前保存、检查或应用操作结束。');
  if(!preview)return explain('no-preview','尚未打开可应用的草稿预览。','在“检查记录”中打开检查通过的当前草稿。');
  if(preview.godot){
    if(applyError)return explain('apply-error','上一次应用未完成。','请查看下方错误；草稿已更新时返回检查记录，检查并预览当前草稿。');
    return explain('godot-preview','当前显示的是独立预览，尚未应用到正式世界。','选择“应用到世界”后，仍需通过正式版本与进度校验。');
  }
  if(reviewError)return explain('review-unavailable','暂时无法读取这份草稿的评审状态。','稍后会自动刷新；也可选择“刷新状态”。不会据缺失数据放行应用。');
  if(!review){
    if(reviewLoading)return explain('review-loading','正在读取这份草稿的评审状态。','读取完成后会显示是否可以应用。');
    return explain('review-missing','这份草稿尚无可用的需求检查与评审。','请在对话中提交对当前草稿的检查，完成后从“检查记录”重新打开预览。');
  }
  if(!review.current)return explain('stale','这是历史草稿的评审，不能用于当前草稿。','返回“检查记录”，检查当前草稿并打开对应的新预览。');
  if(review.status==='running')return explain('review-running','需求检查与评审仍在进行，暂不能应用。','请等待评审结束；需要停止时可选择“取消评审”。');
  if(['failed','cancelled','interrupted'].includes(review.status))return explain('review-'+review.status,({failed:'评审未完成，暂不能应用。',cancelled:'评审已取消，暂不能应用。',interrupted:'评审已中断，暂不能应用。'})[review.status],'查看评审详情；准备继续时可选择“重新评审”，它会重新调用评审服务。');
  if(review.status!=='completed')return explain('review-unknown','尚未取得可确认的评审结果。','选择“刷新状态”，或返回检查记录核对当前草稿。');
  if(review.acceptance?.passed===false)return explain('review-warnings','评审发现问题，普通应用暂不可用。','先查看需求与建议；可继续修改，或明确选择“带评审提示应用”。正式检查与版本校验仍然有效。');
  if(!review.acceptance?.passed)return explain('review-incomplete','评审已结束，但需求检查结果缺失。','请刷新状态；若仍缺失，重新检查当前草稿。');
  if(applyError)return explain('apply-error','上一次应用未完成。','查看下方错误并核对当前草稿；可重试，正式服务会再次校验。');
  return result;
}
