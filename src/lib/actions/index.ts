// src/lib/actions/index.ts

export {
  createApiKeyAction,
  getApiKeysAction,
  revokeApiKeyAction,
} from './apiKeyActions';

export {
  getAthleteRankingData,
  _computeAthleteRankings,
  _computeLegacyAthletes,
  getLegacyAthletesAction,
  sendYearlyRecapEmailAction,
} from './athleteRankingActions';

export {
  createBackupAction,
  getBackupsForEventAction,
  deleteBackupAction,
  restoreBackupAction,
  restoreBackupToNewEventAction,
} from './backupActions';

export {
  assignNextAvailableBib,
  getBibAssignmentsForTicketAction,
  saveBibAssignmentsAction,
  cloneBibAssignmentsAction,
  assignMissingBibsAction,
  reassignDuplicateBibsAction,
} from './bibActions';

export {
  getBikeRackAssignmentsAction,
  saveBikeRackAssignmentsAction,
  sendBikeRackNotificationsAction,
} from './bikeRackActions';

export {
  processCancellationRequestAction,
  getAllCancellationRequestsAction,
  getCancellationStatsAction,
  initiateRefundForCancellationAction,
  deleteCancellationRequestAction,
  cancelParticipantRegistrationByAdminAction,
} from './cancellationActions';

export {
  calculateUpgradeAmount,
  createCategoryChangeEntry,
  processCategoryChangeFinal,
} from './categoryActions';

export {
  getRecentClubsAction,
  registerClubWithOwner,
  registerClubForExistingUser,
  getAllClubs,
  removeAthleteFromClubAction,
  deleteClubAction,
  getAthletesByClubId,
  fetchClubMemberPerformanceForAdmin,
  _computeClubRankings,
  getClubRankingData,
  updateClubSocialLinks,
  updateClubDetailsAction,
  updateClubLogoUrl,
  syncClubDataForEventParticipantsAction,
  getClubListAction,
  getClubDashboardDataAction,
  sendEncouragementEmailAction,
  syncClubUpcomingIndexAction,
  getClubRegistrationsAction,
} from './clubActions';

export {
    contactUsAction,
    getEnquiriesAction,
    replyToEnquiryAction,
    updateEnquiryStatusAction,
    logUserReplyAction,
} from './contactActions';

export {
  createCouponAction,
  updateCouponAction,
  deleteCouponAction,
  getAllCouponsAction,
  validateCouponAction,
  getAutoApplyCouponForUserAction,
} from './couponActions';

export {
    runDataSyncAction,
    _syncParticipantsToKV,
    _mirrorParticipantToKV,
    _deleteParticipantFromKV,
    syncResultsToKVAction,
    recomputeLeaderboardAction,
    rebuildAllRankingsAction,
    _deleteEventFromKV,
    _syncUserToKV,
} from './dataSyncActions';

export {
  handleDeferral,
  requestDeferralAction,
  getAllDeferralsAction,
  getDeferralStatsAction,
  updateDeferralAction,
  deleteDeferralAction,
  addManualDeferralAction,
  sendMonthlyDeferralReminderEmailAction,
  sendManualDeferralReminderAction,
  getDeferralDetailsByIdAction,
} from './deferralActions';

export {
  sendTestCampaignEmailAction,
  getCampaignLogsAction,
  sendIndividualConfirmationEmailAction,
  sendIndividualConfirmationWhatsAppAction,
  sendIncompleteRegistrationNoticeAction,
} from './emailActions';

export {
  _computeCalendarEvents,
  getCalendarEventsAction,
  getEventBySlugAction,
  getEventByFoodSlugAction,
  getEventDetailsWithTicketsAction,
  addCalendarEventAction,
  updateCalendarEventAction,
  deleteCalendarEventAction,
  cloneEventAction,
  getCategoryChangeLogAction,
  getGeneralSettingAction,
  updateGeneralSettingAction,
} from './eventActions';

export {
  addFaqAction,
  updateFaqAction,
  getFaqsAction,
  deleteFaqAction,
} from './faqActions';

export {
  processRawRead,
  getRawReadsForEventAction,
  getDebugDataForBibAction,
  getLiveTimingDataAction,
} from './ingestActions';

export {
  getInventoryForEventAction,
  updateInventoryStockAction,
  resetInventoryAction,
  saveWaterStationConfigAction,
  cloneWaterStationConfigAction,
} from './inventoryActions';

export {
  syncPaymentToZohoAction,
  syncOnlyPaymentToZohoAction,
  createServiceFeeInvoiceAction,
  syncMissingZohoInvoicesAction,
  uploadInvoiceAndGetUrl,
  sendWhatsAppInvoiceAction,
  sendServiceFeeWhatsAppAction,
} from './invoiceActions';

export {
  deleteZohoInvoiceAction,
  getFinancialsForEventAction,
  getDeferralAccountingAction,
  getCategoryChangeAccountingAction,
} from './accountingActions';

export {
  recordLoopAction,
  getLoopLogsForEventAction,
  deleteLoopLogsForEventAction,
  deleteAthleteLoopLogsAction
} from './loopActions';

export {
  getPagesAction,
  savePagesAction,
  getHomepageSliderItemsAction,
  saveHomepageSliderItemsAction,
  getFooterConfigAction,
  saveFooterConfigAction,
} from './pageActions';

export {
  addParticipantFromUserAction,
  addParticipantToEventAction,
  checkParticipantRegistrationByEmail,
  deleteParticipantFromEventAction,
  getParticipantsForEventAction,
  getParticipantsPaginatedAction,
  updateCategoryForParticipantAction,
  updateParticipantInEventAction,
  updateParticipantStatusAction,
} from './participantActions';


export {
  refundPaymentAction,
  createDeferralFeeOrderAction,
  verifyDeferralFeePaymentAndProcessAction,
  createEventTicketOrderAction,
  createCategoryChangeRazorpayOrderAction,
  verifyCategoryChangePaymentAndProcessAction,
  getPaymentRecordsAction,
} from './paymentActions';

export {
  _internal_fetchAllRaceDataFromFirestore,
  getPublicFinalResultsAction,
  getDistinctEventsFromResultsAction,
  getAthleteRaceHistoryAction,
} from './publicResultActions';

export {
  getRegistrationAttemptsAction,
  deleteRegistrationAttemptAction,
  logRegistrationAttemptAction,
} from './registrationActions';

export {
  getRegistrationStatusAction,
} from './registrationStatusActions';

export {
  testTimingPartnerApiAction,
  removeInactiveUsersAction,
  removeDuplicateUsersAction,
  exportAllUsersAction,
  searchAthletesForAdminAction,
  deleteRaceResultsForEventAction,
  updateRaceResultByAdminAction,
  findDuplicateAthletesAction,
  mergeAthletesAction,
} from './adminActions';

export {
  getRegistrationDebugLogsAction,
  findBrokenRegistrations,
} from './debugActions';

export {
    forceResyncRegistrationAction,
} from './adminSyncActions';

export {
  addPaidFoodItemAction,
  updatePaidFoodItemAction,
  deletePaidFoodItemAction,
  getPaidFoodItemsAction,
  updatePaidFoodItemOrderAction,
  createPaidFoodOrderAction,
  verifyPaidFoodPaymentAction,
  redeemFoodCouponAction,
  resetFoodCouponAction,
  cancelAndRefundPaidFoodOrderAction,
  cancelPaidFoodOrderAction,
  getPaidFoodStatsAndLogsAction,
} from './paidFoodActions';

export {
  getSystemControlAction,
  updateSystemControlAction,
  getSystemControlLogsAction,
  getServiceFeesAction,
  updateServiceFeesAction,
} from './systemActions';

export {
  getWhatsAppLogsAction,
  sendTestWhatsAppCampaignAction,
  scheduleWhatsAppCampaignAction,
  getScheduledCampaignsAction,
  cancelScheduledCampaignAction,
} from './whatsappActions';

export {
  getVolunteerStatsAction,
  getAllVolunteersAction,
  createAndAssignVolunteerAction,
  assignVolunteerToEventAction,
  removeVolunteerAssignmentAction,
  searchParticipantsForCheckInAction,
  manualBikeCheckOutAction,
  resetBikeCheckInAction,
  sendBikeCheckoutReminderAction,
  getCheckInStatsForEventAction,
  markItemIssuedAction,
  updateParticipantTshirtSizeAction,
  resetIssuedItemStatusAction,
  assignLockerAction,
  returnLockerAction,
  resetLockerAction,
  resetBikeCheckOutAction,
} from './volunteerActions';

export {
  finalizeRegistration as submitPublicEventRegistrationAction,
} from '../registrationEngine/finalizeRegistration';

export {
  sendRegistrationNotifications
} from '../registrationEngine/registrationNotifications';

export {
  syncRegistrationToZoho
} from '../registrationEngine/zohoSync';

export {
  addAnnouncementAction,
  updateAnnouncementAction,
  deleteAnnouncementAction,
  getActiveAnnouncementsAction,
  getAllAnnouncementsAdminAction,
} from './announcementActions';

export {
  getStoreProductsAction,
  getStoreProductBySlugAction,
  saveStoreProductAction,
  deleteStoreProductAction,
  getStoreOrdersAction,
  updateStoreOrderStatusAction,
  getStoreAnalyticsAction,
  getStoreCouponsAction,
  saveStoreCouponAction,
  getStoreSettingsAction,
  saveStoreSettingsAction,
  cancelAndRefundStoreOrderAction,
  sendStoreInvoiceWhatsAppAction,
  syncStoreOrderToZohoAction,
  updateStoreProductOrderAction
} from './storeActions';

export {
  getSponsorsAction,
  addSponsorAction,
  deleteSponsorAction,
  updateSponsorOrderAction,
  updateSponsorAction,
} from './sponsorActions';

export {
  getTicketDefinitionsForEventAction,
  addTicketDefinitionAction,
  updateTicketDefinitionAction,
  deleteTicketDefinitionAction,
  updateTicketOrderAction,
  cloneTicketDataAction,
} from './ticketActions';

export {
  getAthleteRegisteredEventsAction,
  createUserAction,
  getBlacklistedUsersAction,
  blacklistUserAction,
  unblacklistUserAction,
  getEligibleEventsForDeferralAction,
  updateUserProfile,
  clearActiveCancellationNoticeAction,
  clearActiveDeferralNoticeAction,
  getPerformanceRewardAction,
  linkAccountOnLoginAction,
} from './userActions';

export {
  getAdminAthleteAnalyticsAction,
  compareEventParticipantsAction,
  getGlobalParticipantStatsAction,
  getEventRegistrationOverviewMetricsAction,
  _computeRetentionStats,
  _computeAdminAthleteAnalytics,
  _computeGlobalParticipantStats,
} from './analyticsActions';
